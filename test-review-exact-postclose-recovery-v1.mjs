import assert from "node:assert/strict";
import fs from "node:fs";
import { readExactOpenReview, validReviewId } from "./src/lib/review-exact-read.mjs";

const app = fs.readFileSync("public/app.js", "utf8");
const endpoint = fs.readFileSync("netlify/functions/review-exact.mjs", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");
const core = fs.readFileSync("src/lib/review-exact-read.mjs", "utf8");

assert.equal(validReviewId("25405"),25405);
for (const bad of ["0", "-1", "2.1", "abc", "9007199254740999", "1e3"]) {
  assert.equal(validReviewId(bad),null);
}

const fixture = {
  review_items: { id: 25405, message_record_id: "MID", status: "OPEN", created_at: "2026-10-16T05:00:00Z" },
  messages: { id: "MID", settlement_session_id: "SID", summary_group_id: "SOUTHEAST",
    summary_group_round_id: "RID", line_group_id: "LG", message_type: "text",
    raw_text: "01=20", parse_status: "PARTIAL", unsent: false,
    created_at: "2026-10-16T05:00:00Z" },
  settlement_summary_group_rounds: [{ id: "RID", round_no: 7, status: "CLOSED" }],
  settlement_line_group_round_config: { round_id: "RID", line_group_id: "LG", line_group_name: "LG Alpha" },
  staff_workbench_claim_state: [],
};

function client(rows) {
  const operations=[];
  return { operations, from(table) {
    const q={
      select() { return q; }, eq(name,value) { operations.push([table,name,value]); return q; },
      order() { return q; }, limit() { return Promise.resolve({ data: rows[table], error:null }); },
      maybeSingle() { return Promise.resolve({ data: rows[table] ?? null, error:null }); },
    };
    return q;
  }, rpc(name,args) {
    operations.push(["RPC",name,args]);
    return Promise.resolve({ data: rows.staff_workbench_claim_state, error:null });
  }};
}
const params={reviewId:25405,settlementSessionId:"SID",summaryGroupId:"SOUTHEAST",messageRecordId:"MID",allowedLineGroupIds:["LG"],actorStaffId:"STAFF"};
{
  const c=client(fixture);
  const result=await readExactOpenReview(c,params);
  assert.equal(result.item.id,25405);
  assert.equal(result.item.claim_state,"AVAILABLE");
  assert.equal(result.item.line_group_name,"LG Alpha");
  assert.equal(result.item.parse_status,"PARTIAL");
  assert.equal(result.item.summary_group_round_id,"RID");
  assert.ok(c.operations.some(x=>x[0]==="review_items"&&x[1]==="id"&&x[2]===25405));
}
for (const [label,partial,opts] of [
  ["resolved Review", {review_items:{...fixture.review_items,status:"RESOLVED"}},{}],
  ["unsent message", {messages:{...fixture.messages,unsent:true}},{}],
  ["closed Settlement", {}, {settlementSessionId:"OTHER_SESSION"}],
  ["wrong summary", {}, {summaryGroupId:"SOUTH"}],
  ["wrong message", {}, {messageRecordId:"OTHER_MESSAGE"}],
  ["unauthorized line group", {}, {allowedLineGroupIds:["OTHER_LG"]}],
  ["previous Round", {settlement_summary_group_rounds:[{id:"NEW_RID",round_no:8,status:"OPEN"}]},{}],
  ["missing immutable Round config", {settlement_line_group_round_config:null},{}],
]) {
  const c=client({...fixture,...partial});
  const result=await readExactOpenReview(c,{...params,...opts});
  assert.equal(result,null,label);
}
assert.doesNotMatch(core,/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\bfetch\(/);
assert.doesNotMatch(endpoint,/method\s*===?\s*["']POST["']/);
assert.match(endpoint,/requireDashboardAccess/);
assert.match(endpoint,/authenticateWorkbenchActor/);
assert.match(endpoint,/loadActorSessionLineGroupIds/);
assert.match(endpoint,/readExactOpenReview/);
assert.match(endpoint,/path:\s*["']\/api\/review-exact/);
assert.doesNotMatch(endpoint,/image_storage_path:\s*exact\.image_storage_path/);

assert.match(app,/function liveReviewCardHtml\(item\)/);
const fallback=app.slice(app.indexOf('function selectStaffVerificationWorkbenchItem('),app.indexOf('async function loadMoreStaffVerificationFeed('));
assert.match(fallback,/verification-live-review-missing/);
assert.match(fallback,/recoverMissingLiveReviewCard\(/);
assert.ok(fallback.indexOf("verification-live-review-missing") < fallback.indexOf("root._staffVerificationActor"),"fail-closed before Human Verification");
const recovery=app.slice(app.indexOf('async function recoverMissingLiveReviewCard('),app.indexOf('function selectStaffVerificationWorkbenchItem('));
assert.match(recovery,/\/api\/review-exact/);
assert.match(recovery,/String\(item\.message_record_id\) !== key/);
assert.match(recovery,/summaryGroupSelect\.value !== requestedGroup/);
assert.match(recovery,/liveReviewCardHtml\(item\)/);
assert.doesNotMatch(recovery,/\/api\/review-resolve|\/api\/staff-work-claim|method:\s*["']POST/);

const queue=app.slice(app.indexOf('async function appendStaffPostCloseReviewQueue('),app.indexOf('\/\* Review Scanable Cards + Unified Split Review v4 \*\/'));
assert.doesNotMatch(queue,/if \(STAFF_INCIDENT_MINIMAL_MODE\)/);
assert.match(queue,/state\.authMode !== "STAFF"/);
assert.match(queue,/addEventListener\("toggle"/);
assert.match(queue,/if \(!details\.open/);
assert.match(queue,/root\._postCloseLoadStarted/);
assert.equal((queue.match(/loadStaffPostCloseReviewPage\(/g)||[]).length,1);
assert.match(app,/const STAFF_INCIDENT_MINIMAL_MODE = true/);
assert.match(css, /#reviewList\s+#postCloseReviewQueue\s*\{\s*display:\s*block\s*!important/);
console.log('PASS: exact Review read rejects resolved/unsent/wrong session/Round/group/assignment');
console.log('PASS: current latest CLOSED Summary Round inside active Settlement retains existing read boundary');
console.log('PASS: missing Card triggers bounded GET; fail-closed and ownership remain enforced');
console.log('PASS: Post-close queue is Staff-only and lazy; heavy incident feeds remain suppressed');
console.log('PASS: no writes, SQL, LINE or Review lifecycle mutation in exact-read API');
