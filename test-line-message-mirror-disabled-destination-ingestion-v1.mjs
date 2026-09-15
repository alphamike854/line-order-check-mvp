import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260915090000_fix_disabled_mirror_destination_ingestion.sql",
  "utf8",
);

const originalGuard = fs.readFileSync(
  "supabase/migrations/20260914021500_add_line_mirror_destination_ingestion_deny.sql",
  "utf8",
);

const webhook = fs.readFileSync(
  "netlify/functions/line-webhook.mjs",
  "utf8",
);

const sql = migration
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*$/gm, "");

assert.match(
  sql,
  /create\s+or\s+replace\s+function\s+public\.claim_webhook_event/i,
  "P0-01 claim_webhook_event must be replaced",
);

assert.match(
  sql,
  /destination_line_group_id\s*=\s*p_line_group_id[\s\S]{0,120}?and\s+r\.enabled\s*=\s*true/i,
  "P0-02 only enabled Mirror routes may establish destination ingestion deny",
);

assert.match(
  sql,
  /'DENIED'[\s\S]*?'MIRROR_DESTINATION'/i,
  "P0-03 enabled Mirror destination must retain loop-prevention deny",
);

assert.doesNotMatch(
  sql,
  /\b(?:insert\s+into|update|delete\s+from)\s+public\.line_message_mirror_routes\b/i,
  "P0-04 migration must not mutate Mirror route configuration",
);

assert.doesNotMatch(
  sql,
  /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:messages|order_items)\b/i,
  "P0-05 migration must not mutate accepted order data",
);

assert.match(
  originalGuard,
  /destination_line_group_id\s*=\s*p_line_group_id/i,
  "P0-06 regression fixture must contain old destination check",
);

assert.match(
  webhook,
  /claim_webhook_event/i,
  "P0-07 webhook must continue using the DB claim boundary",
);

console.log(
  "PASS P0-01..P0-07: disabled Mirror destination remains normal ingestion room",
);
