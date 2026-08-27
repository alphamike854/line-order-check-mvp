import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260827053000_live_summary_group_remap.sql",
  "utf8",
);

const settings = fs.readFileSync(
  "netlify/functions/settings.mjs",
  "utf8",
);

assert.match(
  migration,
  /create or replace function public\.save_line_group_live/,
  "atomic LINE-group save RPC must exist",
);

assert.match(
  migration,
  /LINE_ORDER_SETTLEMENT_OPEN_CLOSE/,
  "remap must serialize against settlement open/close",
);

assert.match(
  migration,
  /where status = 'OPEN'[\s\S]*for update/,
  "only the OPEN settlement may be remapped and it must be locked",
);

assert.match(
  migration,
  /settlement_allocation_confirmations/,
  "remap must guard confirmed allocation",
);

assert.match(
  migration,
  /settlement_transfer_batches/,
  "remap must guard confirmed transfer batches",
);

assert.match(
  migration,
  /settlement_distribution_runs/,
  "remap must guard confirmed distribution runs",
);

assert.match(
  migration,
  /update public\.messages[\s\S]*settlement_session_id = v_session_id[\s\S]*line_group_id = p_line_group_id/,
  "all current-session messages for the LINE group must move",
);

assert.match(
  migration,
  /update public\.order_items[\s\S]*settlement_session_id = v_session_id[\s\S]*line_group_id = p_line_group_id/,
  "all canonical items for the LINE group must move",
);

assert.match(
  migration,
  /update public\.settlement_line_group_config[\s\S]*summary_group_id = p_summary_group_id/,
  "OPEN settlement mapping must move to the new summary group",
);

assert.match(
  migration,
  /CLOSED_SETTLEMENT|where status = 'OPEN'/,
  "closed settlement history must remain protected",
);

assert.match(
  migration,
  /grant execute on function public\.save_line_group_live[\s\S]*service_role/,
  "RPC must be service-role only",
);

assert.match(
  settings,
  /SUMMARY_GROUP_REMAP_BLOCKED_/,
  "settings endpoint must expose remap conflict as a controlled error",
);

assert.match(
  settings,
  /saveError\.code\s*===\s*"40P01"/,
  "live remap must retry PostgreSQL deadlocks",
);

assert.match(
  settings,
  /saveError\.code\s*===\s*"40001"/,
  "live remap must retry serialization failures",
);

assert.match(
  settings,
  /attempt\s*<\s*2/,
  "transient remap retry must be bounded to one retry",
);

console.log(
  "PASS: atomic live summary-group remap v8.9.1",
);
