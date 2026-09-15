import fs from "node:fs";
import assert from "node:assert/strict";

const migration =
  fs.readFileSync(
    new URL(
      "./supabase/migrations/20260915133000_harden_mirror_route_settings_atomic.sql",
      import.meta.url,
    ),
    "utf8",
  );

const lineageMigration =
  fs.readFileSync(
    new URL(
      "./supabase/migrations/20260915030000_add_round_line_group_config_lineage.sql",
      import.meta.url,
    ),
    "utf8",
  );


const settings =
  fs.readFileSync(
    new URL(
      "./netlify/functions/settings.mjs",
      import.meta.url,
    ),
    "utf8",
  );

const pkg =
  fs.readFileSync(
    new URL(
      "./package.json",
      import.meta.url,
    ),
    "utf8",
  );

function functionRegion(
  source,
  signature,
) {
  const start =
    source.indexOf(signature);

  assert.ok(
    start >= 0,
    `missing ${signature}`,
  );

  const candidates = [
    source.indexOf(
      "\nasync function ",
      start + signature.length,
    ),
    source.indexOf(
      "\nexport default",
      start + signature.length,
    ),
  ].filter(
    (value) =>
      value >= 0,
  );

  assert.ok(
    candidates.length > 0,
    `cannot bound ${signature}`,
  );

  return source.slice(
    start,
    Math.min(...candidates),
  );
}


// MR1H-01
assert.match(
  migration,
  /settings_change_events_entity_type_check[\s\S]*'MIRROR_ROUTE'/,
);
console.log(
  "PASS MR1H-01: Settings audit accepts MIRROR_ROUTE",
);


// MR1H-02
assert.match(
  migration,
  /create or replace function\s+public\.save_mirror_route_settings\s*\(/i,
);
console.log(
  "PASS MR1H-02: transactional Mirror settings RPC exists",
);


// MR1H-03
assert.match(
  migration,
  /save_mirror_route_settings[\s\S]*security definer[\s\S]*set search_path\s*=\s*public/i,
);
assert.match(
  migration,
  /grant execute on function\s+public\.save_mirror_route_settings[\s\S]*to service_role/i,
);
assert.match(
  migration,
  /revoke all on function\s+public\.save_mirror_route_settings[\s\S]*from public,\s*anon,\s*authenticated/i,
);
console.log(
  "PASS MR1H-03: RPC remains service-role only",
);


// MR1H-04
assert.match(
  migration,
  /enforce_line_message_mirror_route_identity_immutable/i,
);
assert.match(
  migration,
  /before update of\s+source_line_group_id,\s*destination_line_group_id[\s\S]*line_message_mirror_routes/i,
);
assert.match(
  migration,
  /MIRROR_ROUTE_IDENTITY_IMMUTABLE/,
);
console.log(
  "PASS MR1H-04: DB table boundary makes route identity immutable",
);


const rpcStart =
  migration.indexOf(
    "create or replace function\n  public.save_mirror_route_settings",
  );

assert.ok(
  rpcStart >= 0,
  "RPC start missing",
);

const rpcEnd =
  migration.indexOf(
    "\n\nrevoke all on function",
    rpcStart,
  );

assert.ok(
  rpcEnd > rpcStart,
  "RPC end missing",
);

const rpc =
  migration.slice(
    rpcStart,
    rpcEnd,
  );


// MR1H-05
assert.match(
  rpc,
  /from public\.line_message_mirror_routes r[\s\S]*where r\.id = p_route_id[\s\S]*for update/i,
);
console.log(
  "PASS MR1H-05: existing route is row-locked before mutation",
);


// MR1H-06
assert.match(
  rpc,
  /v_before\.source_line_group_id[\s\S]*v_source_line_group_id[\s\S]*v_before\.destination_line_group_id[\s\S]*v_destination_line_group_id[\s\S]*MIRROR_ROUTE_IDENTITY_IMMUTABLE/i,
);
console.log(
  "PASS MR1H-06: RPC rejects identity replacement",
);


// MR1H-07
const updateStart =
  rpc.indexOf(
    "update public.line_message_mirror_routes",
  );

const updateEnd =
  rpc.indexOf(
    "returning *",
    updateStart,
  );

assert.ok(
  updateStart >= 0
  && updateEnd > updateStart,
  "route UPDATE block missing",
);

const updateBlock =
  rpc.slice(
    updateStart,
    updateEnd,
  );

assert.match(
  updateBlock,
  /\benabled\s*=/,
);
assert.match(
  updateBlock,
  /\bmax_batch_size\s*=/,
);
assert.match(
  updateBlock,
  /\bflush_after_seconds\s*=/,
);
assert.doesNotMatch(
  updateBlock,
  /\bsource_line_group_id\s*=/,
);
assert.doesNotMatch(
  updateBlock,
  /\bdestination_line_group_id\s*=/,
);

console.log(
  "PASS MR1H-07: existing route UPDATE changes mutable fields only",
);


// MR1H-08
assert.match(
  rpc,
  /insert into public\.line_message_mirror_routes\s*\(\s*source_line_group_id,\s*destination_line_group_id,\s*enabled,\s*max_batch_size,\s*flush_after_seconds/i,
);
console.log(
  "PASS MR1H-08: create path retains explicit route identity",
);


// MR1H-09
const routeMutationPosition =
  rpc.indexOf(
    "update public.line_message_mirror_routes",
  );

const auditPosition =
  rpc.indexOf(
    "insert into public.settings_change_events",
  );

assert.ok(
  routeMutationPosition >= 0
  && auditPosition > routeMutationPosition,
);

assert.match(
  rpc,
  /'MIRROR_ROUTE'[\s\S]*'UPSERT'/,
);

console.log(
  "PASS MR1H-09: route mutation and audit share one RPC transaction",
);


// MR1H-10
assert.match(
  rpc,
  /public\.settlement_summary_group_rounds r[\s\S]*public\.settlement_line_group_round_config cfg[\s\S]*cfg\.round_id\s*=\s*r\.id[\s\S]*r\.status\s*=\s*'OPEN'[\s\S]*cfg\.line_group_id\s*=\s*v_destination_line_group_id/i,
);
console.log(
  "PASS MR1H-10: enabled destination is rejected by OPEN Round lineage authority",
);


// MR1H-11
assert.match(
  rpc,
  /from public\.line_groups lg[\s\S]*lg\.line_group_id\s*=\s*v_source_line_group_id[\s\S]*MIRROR_SOURCE_NOT_FOUND/i,
);
assert.match(
  rpc,
  /if not v_source_enabled[\s\S]*MIRROR_SOURCE_DISABLED/i,
);
console.log(
  "PASS MR1H-11: configured source existence/enabled policy retained",
);


// MR1H-12
assert.match(
  rpc,
  /v_destination_configured[\s\S]*v_destination_enabled[\s\S]*MIRROR_DESTINATION_ACTIVE_ORDER_GROUP/i,
);
console.log(
  "PASS MR1H-12: configured active order destination remains prohibited",
);


// MR1H-13
assert.match(
  rpc,
  /public\.webhook_events[\s\S]*line_group_id\s*=\s*v_destination_line_group_id/i,
);
assert.match(
  rpc,
  /public\.line_message_mirror_routes[\s\S]*destination_line_group_id\s*=\s*v_destination_line_group_id/i,
);
console.log(
  "PASS MR1H-13: configured/observed/existing destination registry semantics retained",
);


// MR1H-14
assert.match(
  migration,
  /39c6877e-5a05-4592-ac68-fbcc163c2a9a/i,
);
assert.match(
  migration,
  /C4212b95275363a5ea933f25965ab207e/i,
);
assert.match(
  migration,
  /C0eb57909d1308627bf504614228c360b/i,
);
assert.match(
  migration,
  /MIGRATION_REPAIR_MR1_PARTIAL_WRITE/,
);
console.log(
  "PASS MR1H-14: known partial-write repair is identity-locked",
);


// MR1H-15
const repairStart =
  migration.indexOf(
    "-- 4. One-time repair",
  );

assert.ok(
  repairStart >= 0,
  "repair section missing",
);

const repair =
  migration.slice(
    repairStart,
  );

assert.match(
  repair,
  /before_data,[\s\S]*after_data,[\s\S]*changed_by/i,
);
assert.match(
  repair,
  /'UPSERT',\s*null,\s*to_jsonb\(v_route\),\s*'MIGRATION_REPAIR_MR1_PARTIAL_WRITE'/i,
);
assert.doesNotMatch(
  repair,
  /update\s+public\.line_message_mirror_routes/i,
);
assert.doesNotMatch(
  repair,
  /insert\s+into\s+public\.line_message_mirror_routes/i,
);
console.log(
  "PASS MR1H-15: repair adds audit evidence only; route is never recreated/rewritten",
);


const saveRoute =
  functionRegion(
    settings,
    "async function saveMirrorRoute(values)",
  );


// MR1H-16
assert.match(
  saveRoute,
  /supabase\.rpc\(\s*"save_mirror_route_settings"/,
);

assert.doesNotMatch(
  saveRoute,
  /\.update\(payload\)/,
);

assert.doesNotMatch(
  saveRoute,
  /\.insert\(payload\)/,
);

assert.doesNotMatch(
  saveRoute,
  /writeSettingsAudit/,
);

console.log(
  "PASS MR1H-16: Settings route path no longer performs split direct writes",
);


// MR1H-17
assert.match(
  saveRoute,
  /identityChanged[\s\S]*MIRROR_ROUTE_IDENTITY_IMMUTABLE/,
);
assert.doesNotMatch(
  saveRoute,
  /before\.enabled[\s\S]*identityChanged[\s\S]*MIRROR_ROUTE_DISABLE_BEFORE_REMAP/,
);
console.log(
  "PASS MR1H-17: application route identity is immutable even while disabled",
);


// MR1H-18
assert.match(
  saveRoute,
  /mirrorTransportEnabled\(\)/,
);
assert.match(
  saveRoute,
  /MIRROR_GLOBAL_DISABLED/,
);
console.log(
  "PASS MR1H-18: Netlify global transport gate remains application-owned",
);


// MR1H-19
assert.match(
  saveRoute,
  /destination\.configured\?\.enabled[\s\S]*MIRROR_DESTINATION_ACTIVE_ORDER_GROUP/,
);
console.log(
  "PASS MR1H-19: fast application destination guard retained",
);


// MR1H-20
assert.match(
  settings,
  /message === "MIRROR_ROUTE_IDENTITY_IMMUTABLE"/,
);
console.log(
  "PASS MR1H-20: immutable-identity conflict reaches stable Settings error mapping",
);


// MR1H-21
assert.match(
  pkg,
  /test-line-message-mirror-route-settings-v1\.mjs[\s\S]*test-line-message-mirror-route-settings-hardening-v1\.mjs/,
);
console.log(
  "PASS MR1H-21: hardening regression registered after MR1 baseline",
);




// MR1H-22
assert.match(
  rpc,
  /MIRROR_ORDER_INPUT_BOUNDARY[\s\S]*v_destination_line_group_id/,
);
console.log(
  "PASS MR1H-22: Mirror activation RPC takes shared per-LINE-group boundary lock",
);


// MR1H-23
assert.match(
  rpc,
  /settlement_line_group_config cfg[\s\S]*settlement_sessions s[\s\S]*s\.status\s*=\s*'OPEN'[\s\S]*cfg\.line_group_id\s*=\s*v_destination_line_group_id[\s\S]*cfg\.enabled\s*=\s*true[\s\S]*MIRROR_DESTINATION_ACTIVE_ORDER_GROUP/i,
);
console.log(
  "PASS MR1H-23: Mirror activation rejects enabled current route in OPEN parent",
);


// MR1H-24
assert.match(
  migration,
  /create or replace function\s+public\.enforce_mirror_route_activation_boundary\(\)[\s\S]*MIRROR_ORDER_INPUT_BOUNDARY[\s\S]*line_groups[\s\S]*settlement_line_group_config[\s\S]*settlement_line_group_round_config[\s\S]*MIRROR_DESTINATION_ACTIVE_ORDER_GROUP/i,
);
assert.match(
  migration,
  /create trigger\s+line_message_mirror_route_activation_boundary_trg[\s\S]*before insert[\s\S]*update of\s+enabled[\s\S]*line_message_mirror_routes/i,
);
console.log(
  "PASS MR1H-24: direct Mirror route activation is DB-guarded",
);


// MR1H-25
assert.match(
  migration,
  /create or replace function\s+public\.enforce_line_group_mirror_destination_boundary\(\)[\s\S]*MIRROR_ORDER_INPUT_BOUNDARY[\s\S]*line_message_mirror_routes[\s\S]*r\.enabled\s*=\s*true[\s\S]*MIRROR_DESTINATION_ACTIVE_ORDER_GROUP/i,
);
assert.match(
  migration,
  /create trigger\s+line_group_mirror_destination_boundary_trg[\s\S]*before insert[\s\S]*update of\s+enabled[\s\S]*line_groups/i,
);
console.log(
  "PASS MR1H-25: master LINE Group enable is symmetrically DB-guarded",
);


// MR1H-26
assert.match(
  migration,
  /create or replace function\s+public\.enforce_settlement_line_group_mirror_destination_boundary\(\)[\s\S]*settlement_sessions[\s\S]*status\s*=\s*'OPEN'[\s\S]*MIRROR_ORDER_INPUT_BOUNDARY[\s\S]*line_message_mirror_routes[\s\S]*r\.enabled\s*=\s*true/i,
);
assert.match(
  migration,
  /create trigger\s+settlement_line_group_mirror_destination_boundary_trg[\s\S]*before insert[\s\S]*update of[\s\S]*enabled,[\s\S]*line_group_id,[\s\S]*settlement_session_id[\s\S]*settlement_line_group_config/i,
);
console.log(
  "PASS MR1H-26: active parent current-route enable is symmetrically DB-guarded",
);


// MR1H-27
assert.match(
  migration,
  /create or replace function\s+public\.enforce_open_round_mirror_destination_boundary\(\)[\s\S]*order by cfg\.line_group_id[\s\S]*MIRROR_ORDER_INPUT_BOUNDARY[\s\S]*line_message_mirror_routes[\s\S]*r\.enabled\s*=\s*true/i,
);
assert.match(
  migration,
  /create trigger\s+settlement_round_mirror_destination_boundary_trg[\s\S]*before insert[\s\S]*settlement_summary_group_rounds[\s\S]*new\.status\s*=\s*'OPEN'/i,
);
console.log(
  "PASS MR1H-27: OPEN Round takes deterministic shared locks and rejects Mirror destinations",
);


// MR1H-28
const sharedBoundaryOccurrences =
  (
    migration.match(
      /MIRROR_ORDER_INPUT_BOUNDARY/g,
    )
    || []
  ).length;

assert.ok(
  sharedBoundaryOccurrences >= 5,
  `expected shared lock domain across RPC + DB boundaries; got ${sharedBoundaryOccurrences}`,
);

console.log(
  "PASS MR1H-28: one shared advisory-lock namespace spans both domains",
);


// MR1H-29
assert.match(
  migration,
  /settlement_round_mirror_destination_boundary_trg[\s\S]*before insert[\s\S]*settlement_summary_group_rounds/i,
);

assert.match(
  lineageMigration,
  /create trigger\s+settlement_round_capture_line_group_config_trg[\s\S]*after insert[\s\S]*settlement_summary_group_rounds[\s\S]*capture_settlement_line_group_round_config/i,
);

assert.doesNotMatch(
  migration,
  /drop trigger if exists\s+settlement_round_capture_line_group_config_trg/i,
);

assert.doesNotMatch(
  migration,
  /create trigger\s+settlement_round_capture_line_group_config_trg/i,
);

console.log(
  "PASS MR1H-29: Mirror Round guard supplements existing immutable lineage capture without replacing it",
);


console.log(
  "PASS MR1H-01..MR1H-29: atomic immutable symmetric Mirror Route Settings hardening contract",
);
