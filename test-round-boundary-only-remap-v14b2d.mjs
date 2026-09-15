import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260915060000_replace_live_remap_with_round_boundary_only.sql",
  "utf8",
);

const settings = fs.readFileSync(
  "netlify/functions/settings.mjs",
  "utf8",
);

const sql = migration
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*$/gm, "");

assert.match(
  sql,
  /create\s+or\s+replace\s+function\s+public\.save_line_group_live\s*\(\s*p_line_group_id\s+text\s*,\s*p_line_group_name\s+text\s*,\s*p_summary_group_id\s+text\s*,\s*p_reduction_pct\s+numeric\s*,\s*p_enabled\s+boolean\s*\)/i,
  "D-01/D-02 RPC signature must remain unchanged",
);

assert.match(
  sql,
  /returns\s+jsonb[\s\S]*?security\s+definer/i,
  "RPC result/security contract must remain jsonb security definer",
);

assert.match(
  sql,
  /LINE_ORDER_SETTLEMENT_OPEN_CLOSE/,
  "D-03 lifecycle serialization must remain",
);

assert.match(
  sql,
  /from\s+public\.summary_groups[\s\S]*?id\s*=\s*p_summary_group_id[\s\S]*?SUMMARY_GROUP_NOT_FOUND/i,
  "D-04 destination Summary Group validation must remain",
);

assert.match(
  sql,
  /public\.settlement_summary_group_rounds/i,
  "D-05 Round authority must be consulted",
);

assert.match(
  sql,
  /status\s*=\s*'OPEN'/i,
  "D-06 Round OPEN state must be explicit",
);

assert.match(
  sql,
  /SUMMARY_GROUP_REMAP_BLOCKED_SOURCE_OPEN_ROUND/,
  "D-07 source OPEN Round must block identity remap",
);

assert.match(
  sql,
  /SUMMARY_GROUP_REMAP_BLOCKED_DESTINATION_OPEN_ROUND/,
  "D-08 destination OPEN Round must block remap/admission expansion",
);

assert.match(
  sql,
  /v_new_identity_assignment[\s\S]*?v_admission_expansion[\s\S]*?SUMMARY_GROUP_REMAP_BLOCKED_DESTINATION_OPEN_ROUND/i,
  "D-09/D-10 new identity and admission expansion must be destination guarded",
);

assert.match(
  sql,
  /v_master_old_summary_group_id[\s\S]*?v_old_summary_group_id[\s\S]*?SUMMARY_GROUP_REMAP_BLOCKED_SOURCE_OPEN_ROUND/i,
  "source guard must account for both master and current-route pre-change identities",
);

for (const table of [
  "messages",
  "order_items",
  "settlement_line_group_round_config",
  "settlement_summary_group_rounds",
]) {
  assert.doesNotMatch(
    sql,
    new RegExp(
      String.raw`\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?${table}\b`,
      "i",
    ),
    `${table} must be immutable under V14B2D`,
  );
}

assert.match(
  sql,
  /insert\s+into\s+public\.line_groups/i,
  "D-15 master LINE-group registry must still update",
);

assert.match(
  sql,
  /update\s+public\.settlement_line_group_config/i,
  "D-16 existing future route must still update",
);

assert.match(
  sql,
  /insert\s+into\s+public\.settlement_line_group_config/i,
  "D-16 new future route may still be inserted",
);

// Preserve the exact legacy no-parent payload.
assert.match(
  sql,
  /if\s+v_session_id\s+is\s+null\s+then[\s\S]*?return\s+jsonb_build_object\s*\(\s*'line_group'\s*,\s*to_jsonb\(v_saved\)\s*,\s*'open_settlement_id'\s*,\s*null\s*,\s*'remapped'\s*,\s*false\s*,\s*'messages_moved'\s*,\s*0\s*,\s*'items_moved'\s*,\s*0\s*\)/i,
  "legacy no-parent return payload must remain compatible",
);

// Preserve the exact seven-key parent-session payload.
assert.match(
  sql,
  /return\s+jsonb_build_object\s*\(\s*'line_group'\s*,\s*to_jsonb\(v_saved\)\s*,\s*'open_settlement_id'\s*,\s*v_session_id\s*,\s*'old_summary_group_id'\s*,\s*v_old_summary_group_id\s*,\s*'new_summary_group_id'\s*,\s*p_summary_group_id\s*,\s*'remapped'\s*,\s*v_remapped\s*,\s*'messages_moved'\s*,\s*v_messages_moved\s*,\s*'items_moved'\s*,\s*v_items_moved\s*\)/i,
  "legacy seven-key parent return payload must remain compatible",
);

assert.match(
  sql,
  /v_messages_moved\s+integer\s*:=\s*0/i,
  "messages_moved compatibility field must start at zero",
);

assert.match(
  sql,
  /v_items_moved\s+integer\s*:=\s*0/i,
  "items_moved compatibility field must start at zero",
);

assert.doesNotMatch(
  sql,
  /get\s+diagnostics\s+v_messages_moved/i,
  "messages_moved must never count rewritten accepted data",
);

assert.doesNotMatch(
  sql,
  /get\s+diagnostics\s+v_items_moved/i,
  "items_moved must never count rewritten accepted data",
);

// old_summary_group_id retains legacy semantics:
// current route identity before mutation.
assert.match(
  sql,
  /select\s+summary_group_id\s*,\s*enabled\s+into\s+v_old_summary_group_id\s*,\s*v_route_old_enabled\s+from\s+public\.settlement_line_group_config[\s\S]*?for\s+update/i,
  "old_summary_group_id must remain the pre-change current-route identity",
);

assert.match(
  sql,
  /v_remapped\s*:=\s*v_old_summary_group_id\s+is\s+distinct\s+from\s+p_summary_group_id/i,
  "remapped must retain current-route identity-change semantics",
);

assert.match(
  sql,
  /if\s+v_has_snapshot\s+then[\s\S]*?elsif\s+p_enabled\s+then[\s\S]*?insert\s+into\s+public\.settlement_line_group_config/i,
  "new disabled LINE group must not create an active route",
);

assert.doesNotMatch(
  sql,
  /'(?:NORTH|SOUTH|EAST|WEST)'/i,
  "Summary Group identity must remain generic",
);

assert.match(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.save_line_group_live[\s\S]*?to\s+service_role/i,
  "service_role execute grant must remain",
);

for (const role of [
  "public",
  "anon",
  "authenticated",
]) {
  assert.match(
    sql,
    new RegExp(
      String.raw`revoke\s+all\s+on\s+function\s+public\.save_line_group_live[\s\S]*?from\s+${role}`,
      "i",
    ),
    `${role} execute must remain revoked`,
  );
}

assert.match(
  settings,
  /supabase\.rpc\(\s*"save_line_group_live"/,
  "settings must retain same RPC",
);

for (const arg of [
  "p_line_group_id",
  "p_line_group_name",
  "p_summary_group_id",
  "p_reduction_pct",
  "p_enabled",
]) {
  assert.match(
    settings,
    new RegExp(
      String.raw`\b${arg}\s*:`,
    ),
    `settings must retain ${arg}`,
  );
}

assert.match(
  settings,
  /const\s+saved\s*=\s*result\?\.line_group\s*\?\?\s*row/,
  "settings caller must remain compatible with line_group return field",
);

assert.match(
  settings,
  /SUMMARY_GROUP_REMAP_BLOCKED_/,
  "new Round-boundary business errors remain controlled",
);

assert.match(
  settings,
  /saveError\.code\s*===\s*"40P01"/,
  "deadlock retry must remain",
);

assert.match(
  settings,
  /saveError\.code\s*===\s*"40001"/,
  "serialization retry must remain",
);

assert.match(
  settings,
  /attempt\s*<\s*2/,
  "transient retry remains bounded",
);

console.log(
  "PASS D-01..D-34: V14B2D ROUND_BOUNDARY_ONLY remap contract",
);
