import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260915060000_replace_live_remap_with_round_boundary_only.sql",
  "utf8",
);

const sql = migration
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*$/gm, "");

assert.match(
  sql,
  /SUMMARY_GROUP_REMAP_BLOCKED_SOURCE_OPEN_ROUND/,
  "source OPEN Round must block future-only identity remap",
);

assert.match(
  sql,
  /SUMMARY_GROUP_REMAP_BLOCKED_DESTINATION_OPEN_ROUND/,
  "destination OPEN Round must block future-only remap/admission expansion",
);

assert.doesNotMatch(
  sql,
  /\bupdate\s+(?:public\.)?messages\b/i,
  "accepted messages must remain immutable",
);

assert.doesNotMatch(
  sql,
  /\bupdate\s+(?:public\.)?order_items\b/i,
  "accepted order_items must remain immutable",
);

assert.match(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.save_line_group_live[\s\S]*?service_role/i,
  "service-role-only RPC boundary must remain",
);

console.log(
  "PASS: legacy live-remap semantics superseded by V14B2D ROUND_BOUNDARY_ONLY",
);
