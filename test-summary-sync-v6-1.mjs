import fs from "node:fs";
import assert from "node:assert/strict";

const migration = fs.readFileSync("supabase/migrations/202608250009_align_summary_risk_with_settlement_snapshot.sql", "utf8");
const webhook = fs.readFileSync("netlify/functions/line-webhook.mjs", "utf8");

assert.match(migration, /cfg\.summary_group_id/);
assert.match(migration, /group by oi\.settlement_session_id,oi\.business_date,cfg\.summary_group_id,oi\.category,oi\.code/);
assert.match(migration, /update public\.order_items oi[\s\S]*set summary_group_id = cfg\.summary_group_id/);
assert.match(webhook, /summary_group_id: message\.summary_group_id \?\? group\.summary_group_id/);

console.log("PASS: Summary and daily report settlement mapping v6.1 smoke tests");
