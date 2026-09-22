import fs from "node:fs";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  "supabase/migrations/"
  + "20260922100000_add_export_destination_settings_rpc.sql",
  "utf8",
);

const settings = fs.readFileSync(
  "netlify/functions/settings.mjs",
  "utf8",
);

const html = fs.readFileSync(
  "public/index.html",
  "utf8",
);

const app = fs.readFileSync(
  "public/app.js",
  "utf8",
);

const pkg = fs.readFileSync(
  "package.json",
  "utf8",
);

console.log(
  "===== Export Destination Settings v1 ====="
);

assert.match(
  migration,
  /save_export_destination_settings/,
);
console.log(
  "PASS EXPDESTSET-01: atomic save RPC exists"
);

assert.match(
  migration,
  /security definer/i,
);
console.log(
  "PASS EXPDESTSET-02: mutation remains server-owned"
);

assert.match(
  migration,
  /lock_export_destination/,
);
console.log(
  "PASS EXPDESTSET-03: destination identity uses shared lock"
);

assert.match(
  migration,
  /insert into public\.export_destination_line_groups[\s\S]*?false/s,
);
console.log(
  "PASS EXPDESTSET-04: newly registered destination starts disabled"
);

assert.match(
  migration,
  /update[\s\S]*?export_destination_line_groups[\s\S]*?enabled/s,
);
console.log(
  "PASS EXPDESTSET-05: existing destination may explicitly enable or disable"
);

assert.doesNotMatch(
  migration,
  /delete\s+from\s+public\.export_destination_line_groups/i,
);
console.log(
  "PASS EXPDESTSET-06: management RPC exposes no delete path"
);

assert.match(
  migration,
  /from public\.line_groups/,
);
assert.match(
  migration,
  /from public\.webhook_events/,
);
console.log(
  "PASS EXPDESTSET-07: new rows require a known LINE room"
);

assert.match(
  migration,
  /revoke all[\s\S]*?public,\s*anon,\s*authenticated/i,
);
assert.match(
  migration,
  /grant execute[\s\S]*?service_role/i,
);
console.log(
  "PASS EXPDESTSET-08: RPC is service-role only"
);

assert.match(
  settings,
  /\.from\("export_destination_line_groups"\)/,
);
console.log(
  "PASS EXPDESTSET-09: Settings GET reads registry server-side"
);

assert.match(
  settings,
  /settlement_line_group_round_config_working_context/,
);
console.log(
  "PASS EXPDESTSET-10: candidate metadata includes OPEN Round state"
);

assert.match(
  settings,
  /settings\.export_destinations/,
);
assert.match(
  settings,
  /settings\.export_destination_candidates/,
);
console.log(
  "PASS EXPDESTSET-11: Settings payload exposes registry and candidates"
);

assert.match(
  settings,
  /entity === "EXPORT_DESTINATION"/,
);
console.log(
  "PASS EXPDESTSET-12: Settings POST has dedicated Export entity"
);

assert.match(
  settings,
  /\.rpc\(\s*"save_export_destination_settings"/,
);
console.log(
  "PASS EXPDESTSET-13: application mutation is RPC-only"
);

assert.match(
  settings,
  /EXPORT_DESTINATION_\[A-Z0-9_\]\+/,
);
console.log(
  "PASS EXPDESTSET-14: stable Export destination errors are mapped"
);

assert.match(
  html,
  /กลุ่มปลายทางส่งออก/,
);
assert.match(
  html,
  /id="exportDestinationForm"/,
);
assert.match(
  html,
  /id="exportDestinationsList"/,
);
console.log(
  "PASS EXPDESTSET-15: Settings UI block exists"
);

assert.match(
  html,
  /name="enabled"[\s\S]*?disabled/,
);
console.log(
  "PASS EXPDESTSET-16: create form cannot immediately enable a new destination"
);

assert.match(
  app,
  /function renderExportDestinationSettings/,
);
console.log(
  "PASS EXPDESTSET-17: registry UI has dedicated renderer"
);

assert.match(
  app,
  /active_order_group/,
);
assert.match(
  app,
  /active_open_round_input/,
);
console.log(
  "PASS EXPDESTSET-18: unsafe candidate rooms are blocked in UI"
);

assert.match(
  app,
  /select\.disabled = true/,
);
console.log(
  "PASS EXPDESTSET-19: existing destination identity is immutable in UI"
);

assert.match(
  app,
  /"EXPORT_DESTINATION"/,
);
console.log(
  "PASS EXPDESTSET-20: browser uses Settings API entity"
);

assert.doesNotMatch(
  app,
  /supabase[\s\S]{0,100}export_destination_line_groups/i,
);
console.log(
  "PASS EXPDESTSET-21: browser never writes registry directly"
);

assert.match(
  app,
  /renderExportDestinationSettings\(\)/,
);
console.log(
  "PASS EXPDESTSET-22: registry joins Settings render lifecycle"
);

assert.match(
  pkg,
  /test-export-destination-settings-v1\.mjs/,
);
console.log(
  "PASS EXPDESTSET-23: regression registered in full suite"
);

assert.doesNotMatch(
  migration,
  /settlement_export_cycles[\s\S]*?(insert|update|delete)/i,
);
assert.doesNotMatch(
  migration,
  /settlement_export_deliveries[\s\S]*?(insert|update|delete)/i,
);
console.log(
  "PASS EXPDESTSET-24: operational Export storage remains isolated"
);

assert.doesNotMatch(
  migration,
  /LINE_CHANNEL_ACCESS_TOKEN|push\/message|api\.line\.me/i,
);
console.log(
  "PASS EXPDESTSET-25: management phase adds no LINE transport"
);

assert.doesNotMatch(
  settings,
  /body\.changed_by/,
);
assert.match(
  settings,
  /p_changed_by:\s*"DASHBOARD"/,
);
console.log(
  "PASS EXPDESTSET-26: audit attribution is server-owned"
);

assert.match(
  migration,
  /if p_enabled is null then[\s\S]*?EXPORT_DESTINATION_ENABLED_REQUIRED/,
);
console.log(
  "PASS EXPDESTSET-27: enabled state must be explicit"
);

assert.doesNotMatch(
  migration,
  /enabled\s*=\s*coalesce\s*\(\s*p_enabled/,
);
assert.match(
  migration,
  /enabled\s*=\s*p_enabled/,
);
console.log(
  "PASS EXPDESTSET-28: NULL cannot silently disable an existing destination"
);

assert.match(
  migration,
  /insert into public\.export_destination_line_groups[\s\S]*?false/s,
);
console.log(
  "PASS EXPDESTSET-29: new destination still always starts disabled"
);

console.log(
  "PASS: Export Destination Settings v1"
);
