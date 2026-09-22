import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/"
    + "20260922094500_add_export_destination_registry_foundation.sql",
    "utf8",
  );

const webhook =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const pkg =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

const sql =
  migration
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");

console.log(
  "===== Export Destination Registry Foundation v1 =====",
);

assert.match(
  sql,
  /create\s+table\s+public\.export_destination_line_groups/i,
);

assert.match(
  sql,
  /line_group_id\s+text\s+primary\s+key/i,
);

console.log(
  "PASS EXPDEST-01: dedicated registry exists",
);

assert.doesNotMatch(
  sql,
  /insert\s+into\s+public\.export_destination_line_groups/i,
);

console.log(
  "PASS EXPDEST-02: foundation inserts zero operational destinations",
);

assert.match(
  sql,
  /EXPORT_DESTINATION_LINE_ROOM_NOT_KNOWN/,
);

assert.match(
  sql,
  /public\.webhook_events/,
);

console.log(
  "PASS EXPDEST-03: enabled destination must be a known LINE room",
);

assert.match(
  sql,
  /EXPORT_DESTINATION_ACTIVE_ORDER_GROUP/,
);

assert.match(
  sql,
  /g\.enabled\s*=\s*true/i,
);

console.log(
  "PASS EXPDEST-04: active order-input group excluded",
);

assert.match(
  sql,
  /EXPORT_DESTINATION_ACTIVE_OPEN_ROUND_INPUT/,
);

assert.match(
  sql,
  /round_status\s*=\s*'OPEN'/i,
);

console.log(
  "PASS EXPDEST-05: OPEN Round input excluded",
);

assert.match(
  sql,
  /LINE_GROUP_IS_ACTIVE_EXPORT_DESTINATION/,
);

assert.match(
  sql,
  /line_group_export_destination_guard_trg/,
);

console.log(
  "PASS EXPDEST-06: order-input activation has reciprocal guard",
);

assert.match(
  sql,
  /OPEN_ROUND_LINE_GROUP_IS_EXPORT_DESTINATION/,
);

assert.match(
  sql,
  /round_config_export_destination_guard_trg/,
);

console.log(
  "PASS EXPDEST-07: Round-config insertion has reciprocal guard",
);

assert.match(
  sql,
  /pg_advisory_xact_lock/i,
);

console.log(
  "PASS EXPDEST-08: destination identity is transaction-serialized",
);

assert.match(
  sql,
  /export_cycle_ready_destination_guard_trg/,
);

assert.match(
  sql,
  /new\.destination_label\s*:=\s*public\.assert_export_destination_allowed/i,
);

console.log(
  "PASS EXPDEST-09: READY validates ID and replaces browser label from registry",
);

assert.match(
  sql,
  /export_delivery_sending_destination_guard_trg/,
);

assert.match(
  sql,
  /new\.status\s*=\s*'SENDING'/i,
);

console.log(
  "PASS EXPDEST-10: SENDING/retry revalidates destination",
);

assert.doesNotMatch(
  sql,
  /new\.status\s*=\s*'ACKNOWLEDGED'[\s\S]{0,500}?assert_export_destination_allowed/i,
);

console.log(
  "PASS EXPDEST-11: post-accept ACK remains recoverable",
);

assert.match(
  sql,
  /EXPORT_DESTINATION_HAS_UNRESOLVED_DELIVERY/,
);

assert.match(
  sql,
  /'SENDING'[\s\S]{0,240}?'RETRYABLE'[\s\S]{0,240}?'AMBIGUOUS'/,
);

console.log(
  "PASS EXPDEST-12: unresolved retry identity blocks disable/delete",
);

assert.match(
  sql,
  /v_is_export_destination\s+boolean/i,
);

assert.match(
  sql,
  /from\s+public\.export_destination_line_groups/i,
);

assert.match(
  sql,
  /v_is_mirror_destination\s+or\s+v_is_export_destination/i,
);

console.log(
  "PASS EXPDEST-13: Export destination joins existing claim redaction path",
);

assert.match(
  sql,
  /when\s+v_is_export_destination\s+then\s+'EXPORT_DESTINATION'/i,
);

assert.match(
  sql,
  /else\s+'MIRROR_DESTINATION'/i,
);

console.log(
  "PASS EXPDEST-14: DENIED reason distinguishes Export vs Mirror",
);

assert.match(
  sql,
  /v_stored_user_id\s*:=\s*null/i,
);

assert.match(
  sql,
  /v_stored_payload\s*:=\s*'\{\}'::jsonb/i,
);

assert.match(
  sql,
  /processed_at\s*=\s*coalesce/i,
);

assert.match(
  sql,
  /processing_started_at\s*=\s*null/i,
);

console.log(
  "PASS EXPDEST-15: destination webhook payload remains redacted + terminal",
);

assert.match(
  webhook,
  /claim\?\.state\s*===\s*"DENIED"/,
);

assert.doesNotMatch(
  webhook,
  /export_destination_line_groups/,
);

console.log(
  "PASS EXPDEST-16: no new application webhook lookup added",
);

assert.match(
  sql,
  /public\.line_message_mirror_routes/i,
);

assert.match(
  sql,
  /'MIRROR_DESTINATION'/,
);

assert.doesNotMatch(
  sql,
  /\b(?:insert\s+into|update|delete\s+from)\s+public\.line_message_mirror_routes\b/i,
);

console.log(
  "PASS EXPDEST-17: Mirror route configuration remains untouched",
);

assert.doesNotMatch(
  sql,
  /\b(?:insert\s+into|delete\s+from)\s+public\.(?:messages|order_items)\b/i,
);

assert.doesNotMatch(
  sql,
  /settlement_transfer_batches/,
);

assert.doesNotMatch(
  sql,
  /confirmed_cut_total/,
);

console.log(
  "PASS EXPDEST-18: order / Allocation storage isolated",
);

assert.doesNotMatch(
  sql,
  /LINE_CHANNEL_ACCESS_TOKEN/,
);

assert.doesNotMatch(
  sql,
  /channel_access_token/i,
);

console.log(
  "PASS EXPDEST-19: multi-OA/token remains outside phase",
);

assert.match(
  sql,
  /enable\s+row\s+level\s+security/i,
);

assert.match(
  sql,
  /to\s+service_role/i,
);

console.log(
  "PASS EXPDEST-20: server-only registry boundary",
);

const privateTriggerHelpers = [
  "guard_export_destination_registry",
  "guard_export_destination_delete",
  "guard_line_group_from_export_destination",
  "guard_round_config_from_export_destination",
  "guard_export_cycle_ready_destination",
  "guard_export_delivery_sending_destination",
];

for (const helper of privateTriggerHelpers) {
  const pattern =
    new RegExp(
      "revoke\\s+all"
      + "[\\s\\S]{0,180}?"
      + "public\\."
      + helper
      + "\\(\\)"
      + "[\\s\\S]{0,180}?"
      + "from\\s+public,\\s*anon,\\s*authenticated",
      "i",
    );

  assert.match(
    sql,
    pattern,
    `${helper} must not be browser-callable`,
  );
}

console.log(
  "PASS EXPDEST-21: SECURITY DEFINER trigger helpers are private",
);

assert.match(
  sql,
  /revoke\s+all[\s\S]{0,260}?public\.claim_webhook_event\s*\([\s\S]{0,260}?jsonb[\s\S]{0,120}?from\s+public,\s*anon,\s*authenticated/i,
);

assert.match(
  sql,
  /grant\s+execute[\s\S]{0,260}?public\.claim_webhook_event\s*\([\s\S]{0,260}?jsonb[\s\S]{0,120}?to\s+service_role/i,
);

console.log(
  "PASS EXPDEST-22: replaced claim RPC explicitly remains service-role only",
);

for (const helper of privateTriggerHelpers) {
  const grantPattern =
    new RegExp(
      "grant\\s+execute"
      + "[\\s\\S]{0,180}?"
      + "public\\."
      + helper
      + "\\(\\)"
      + "[\\s\\S]{0,120}?"
      + "to\\s+(?:public|anon|authenticated)",
      "i",
    );

  assert.doesNotMatch(
    sql,
    grantPattern,
    `${helper} must not be granted to browser roles`,
  );
}

console.log(
  "PASS EXPDEST-23: no trigger helper is granted to browser roles",
);

assert.ok(
  pkg.includes(
    "test-export-destination-registry-v1.mjs",
  ),
);

console.log(
  "PASS EXPDEST-24: contract registered in full regression",
);

assert.match(
  sql,
  /select\s+exists\s*\(\s*select\s+1\s+from\s+public\.export_destination_line_groups\s+r[\s\S]{0,500}?\)\s*into\s+v_is_export_destination\s*;/i,
);

console.log(
  "PASS EXPDEST-25: Export destination flag uses complete SELECT EXISTS statement",
);

assert.match(
  sql,
  /select\s+exists\s*\(\s*select\s+1\s+from\s+public\.line_message_mirror_routes\s+r[\s\S]{0,500}?\)\s*into\s+v_is_mirror_destination\s*;/i,
);

console.log(
  "PASS EXPDEST-26: Mirror destination flag retains complete SELECT EXISTS statement",
);

assert.doesNotMatch(
  sql,
  /into\s+v_is_export_destination\s*;\s*select\s+1\s+from\s+public\.line_message_mirror_routes/i,
);

console.log(
  "PASS EXPDEST-27: malformed orphan Mirror SELECT cannot recur",
);

console.log(
  "PASS: Export Destination Registry Foundation v1",
);
