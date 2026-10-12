import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(
  "supabase/migrations/20261010120000_allow_closed_current_round_human_verification_revision.sql", "utf8",
);
const ui = fs.readFileSync("public/app.js", "utf8");
const lib = fs.readFileSync("src/lib/staff-message-verification.mjs", "utf8");
const preview = fs.readFileSync(
  "netlify/functions/staff-verification-correction-preview.mjs", "utf8",
);

function functionSql(name) {
  const marker = `create or replace function\n  public.${name}(`;
  const at = sql.indexOf(marker);
  assert.ok(at >= 0, `${name}: missing definition`);
  const end = sql.indexOf("\n$$;", at);
  assert.ok(end > at, `${name}: no terminator`);
  return sql.slice(at, end + 4);
}
const claim = functionSql("claim_staff_message_verification_revision_work");
const apply = functionSql("revise_staff_message_verification_order");
const wrapperStart = sql.indexOf("create or replace function\n  public.claim_staff_message_verification_revision_work(", sql.indexOf("create or replace function\n  public.claim_staff_message_verification_revision_work(") + 1);
assert.ok(wrapperStart >= 0, "six-arg wrapper missing");
const wrapper = sql.slice(wrapperStart, sql.indexOf("\n$$;", wrapperStart) + 4);
for (const [name, source] of [["claim", claim], ["wrapper", wrapper], ["apply", apply]]) {
  assert.match(source, /LINE_ORDER_SETTLEMENT_OPEN_CLOSE/, `${name}: lifecycle lock missing`);
}
console.log("PASS: revision claim/apply serializes with successor OPEN + purge");

for (const [name, source] of [["claim", claim],["apply",apply]]) {
  assert.match(source, /v_latest_round_id[\s\S]*?MESSAGE_ROUND_NOT_CURRENT/);
  assert.match(source, /not in \('OPEN', 'CLOSED'\)/);
  assert.match(source, /MESSAGE_OUTSIDE_STAFF_SCOPE/);
  assert.match(source, /SETTLEMENT_NOT_OPEN/);
}
console.log("PASS: latest/current round + active session + staff scope preserved");

for (const [name, source] of [["claim", claim], ["apply", apply]]) {
  assert.match(source, /from public\.summary_group_round_runtime_state state[\s\S]*?join public\.settlement_summary_group_rounds r[\s\S]*?r\.id = state\.latest_round_id/,
    `${name}: must use the global current Round cursor`);
  assert.doesNotMatch(source, /order by\s+r\.round_no desc/,
    `${name}: session-local round_no is not a global fence`);
}
console.log("PASS: claim/apply use global current Round cursor");


assert.match(apply, /if v_latest_round_status = 'OPEN' then[\s\S]*?delete from\s+public\.order_items[\s\S]*?insert into\s+public\.order_items/);
const closedStart = apply.indexOf("elsif v_latest_round_status = 'CLOSED' then");
const closedEnd = apply.indexOf("update public.message_verifications", closedStart);
assert.ok(closedStart > 0 && closedEnd > closedStart);
const closedCode = apply.slice(closedStart,closedEnd).split("\n").filter(x=>!x.trim().startsWith("--")).join("\n");
assert.doesNotMatch(closedCode, /\b(?:delete\s+from|insert\s+into|update)\s+public\.(?:messages|order_items)/i);
assert.match(closedCode, /v_canonical_mutation_applied := false/);
console.log("PASS: CLOSED revision modifies Human Truth only");

assert.match(closedCode, /jsonb_agg\(/);
assert.match(closedCode, /upper\(btrim\(item\.value ->> 'category'\)\)/);
assert.match(closedCode, /btrim\(item\.value ->> 'code'\)/);
assert.match(closedCode, /'quantity', \(item\.value ->> 'quantity'\)::integer/);
assert.match(closedCode, /with ordinality as item\(value, position\)/);
console.log("PASS: CLOSED Human Truth normalized using OPEN INT4 contract");


assert.match(apply, /canonical_mutation_applied\s*=\s*v_canonical_mutation_applied/);
assert.match(apply, /revision_no\s*=\s*revision_no\s*\+\s*1/);
assert.match(apply, /STALE_VERIFICATION_REVISION/);
assert.match(apply, /message_verification_revision_events/);
assert.match(apply, /v_before,\s*v_after,\s*v_canonical_mutation_applied/);
assert.match(apply, /'canonical_mutation_applied',\s*v_canonical_mutation_applied/);
console.log("PASS: revision fencing and audit reflect true canonical behavior");

assert.match(lib, /!\["OPEN", "CLOSED"\]\.includes\(\s*latestRound\.status/);
const eligibility = ui.slice(ui.indexOf("function staffVerificationRevisionStatusEligible("), ui.indexOf("function staffVerificationRevisionEditing("));
assert.match(eligibility, /OPEN\|CLOSED/);
assert.match(preview, /canonical_mutation_if_applied:[\s\S]*?access\.round_status\s*=== "OPEN"/);
console.log("PASS: UI/Access enable CLOSED; preview never claims canonical write in CLOSED");

assert.match(sql, /begin;[\s\S]*commit;/);
console.log("PASS: CLOSED Human Verification local static contract");
