import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";


const webhook =
  readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );


const migration =
  readFileSync(
    "supabase/migrations/20260912001000_add_round_owned_message_admission.sql",
    "utf8",
  );


const verificationMigration =
  readFileSync(
    "supabase/migrations/20260907100000_add_message_verification_correction_foundation.sql",
    "utf8",
  );


const s1Migration =
  readFileSync(
    "supabase/migrations/20260831021000_harden_summary_group_settlement_boundary.sql",
    "utf8",
  );


function blockBetween(
  source,
  start,
  end,
) {
  const startIndex =
    source.indexOf(start);

  assert.ok(
    startIndex >= 0,
    `missing start marker: ${start}`,
  );

  const endIndex =
    source.indexOf(
      end,
      startIndex + start.length,
    );

  assert.ok(
    endIndex > startIndex,
    `missing end marker: ${end}`,
  );

  return source.slice(
    startIndex,
    endIndex,
  );
}


// B-01: authoritative message trigger owns Round/date.
assert.match(
  migration,
  /create or replace function\s+public\.assign_message_to_open_settlement\(\)/i,
);

assert.match(
  migration,
  /settlement_summary_group_rounds[\s\S]*?r\.status\s*=\s*'OPEN'/i,
);

assert.match(
  migration,
  /new\.business_date\s*:=\s*v_round\.business_date/i,
);

assert.match(
  migration,
  /new\.summary_group_round_id\s*:=\s*v_round\.id/i,
);

console.log(
  "PASS DR1D-B-01: Round owns admission and business_date",
);


// B-02: admission lock order matches lifecycle.
const admissionFunction =
  blockBetween(
    migration,
    "create or replace function\n  public.assign_message_to_open_settlement()",
    "comment on function\n  public.assign_message_to_open_settlement()",
  );

const globalLock =
  admissionFunction.indexOf(
    "LINE_ORDER_SETTLEMENT_OPEN_CLOSE",
  );

const groupLock =
  admissionFunction.indexOf(
    "SETTLEMENT_SUMMARY_GROUP_CONTROL",
  );

assert.ok(
  globalLock >= 0
  && groupLock > globalLock,
  "admission must lock global boundary before Summary Group boundary",
);

console.log(
  "PASS DR1D-B-02: admission serializes with OPEN_GROUP/CLOSE_GROUP",
);


// B-03: no-open cases abort INSERT.
for (const reason of [
  "SETTLEMENT_NOT_OPEN",
  "GROUP_NOT_CONFIGURED",
  "SUMMARY_GROUP_NOT_OPEN",
]) {
  assert.match(
    migration,
    new RegExp(reason),
  );
}

console.log(
  "PASS DR1D-B-03: no authoritative OPEN Round cannot persist message",
);


// Extract webhook blocks.
const admissionHelper =
  blockBetween(
    webhook,
    "function lineMessageAdmissionFailureReason(",
    "async function createMessage(",
  );

const createMessage =
  blockBetween(
    webhook,
    "async function createMessage(",
    "async function saveReview",
  );

const textHandler =
  blockBetween(
    webhook,
    "async function handleTextMessage(",
    "async function storeImageReviewEvidence",
  );

const imageHandler =
  blockBetween(
    webhook,
    "async function handleImageMessage(",
    "async function handleUnsend",
  );

const findExisting =
  blockBetween(
    webhook,
    "async function findMessageByWebhookEvent(",
    "async function isExistingMessageComplete",
  );


// B-04: application no longer computes message date.
assert.doesNotMatch(
  createMessage,
  /business_date\s*:/,
);

assert.doesNotMatch(
  createMessage,
  /bangkokBusinessDate/,
);

assert.match(
  createMessage,
  /summary_group_round_id/,
);

console.log(
  "PASS DR1D-B-04: application no longer owns message business_date",
);


// B-05: expected admission failures become ignored.
//
// Reason tokens live in admissionHelper, while createMessage()
// consumes that helper and returns ignored:true.
for (const reason of [
  "SETTLEMENT_NOT_OPEN",
  "GROUP_NOT_CONFIGURED",
  "SUMMARY_GROUP_NOT_OPEN",
]) {
  assert.match(
    admissionHelper,
    new RegExp(reason),
  );
}

assert.match(
  createMessage,
  /lineMessageAdmissionFailureReason/,
);

assert.match(
  createMessage,
  /ignored:\s*true/,
);

console.log(
  "PASS DR1D-B-05: expected no-open admission failure becomes IGNORE",
);


// B-06: TEXT ignore happens before parser.
const textIgnore =
  textHandler.indexOf(
    "message?.ignored",
  );

const textParser =
  textHandler.indexOf(
    "loadParserConfig",
  );

assert.ok(
  textIgnore >= 0
  && textParser > textIgnore,
  "TEXT ignore gate must precede parser",
);

console.log(
  "PASS DR1D-B-06: ignored TEXT stops before parser",
);


// B-07: IMAGE ignore happens before provider/OCR path.
const imageIgnore =
  imageHandler.indexOf(
    "message?.ignored",
  );

const imageProvider =
  imageHandler.indexOf(
    "contentProvider",
  );

assert.ok(
  imageIgnore >= 0
  && imageProvider > imageIgnore,
  "IMAGE ignore gate must precede image provider/OCR",
);

console.log(
  "PASS DR1D-B-07: ignored IMAGE stops before OCR/Storage path",
);


// B-08: existing-message retry loads Round ownership.
assert.match(
  findExisting,
  /summary_group_round_id/,
);

assert.match(
  textHandler,
  /message\.summary_group_round_id[\s\S]*message\.summary_group_id/,
);

assert.match(
  imageHandler,
  /message\.summary_group_round_id[\s\S]*message\.summary_group_id/,
);

console.log(
  "PASS DR1D-B-08: retry retains immutable admitted Round ownership",
);


// B-09: current accepting state is legacy-only.
assert.match(
  textHandler,
  /if\s*\(!message\.summary_group_round_id\)[\s\S]*isSettlementSummaryGroupAccepting/,
);

assert.match(
  imageHandler,
  /if\s*\(!message\.summary_group_round_id\)[\s\S]*isSettlementSummaryGroupAccepting/,
);

console.log(
  "PASS DR1D-B-09: admitted messages are not re-admitted after close",
);


// B-10: parser/OCR uses narrow admitted wrapper.
assert.match(
  webhook,
  /persist_parsed_message_atomic_admitted/,
);

assert.match(
  migration,
  /create or replace function\s+public\.persist_parsed_message_atomic_admitted/i,
);

assert.match(
  migration,
  /MESSAGE_NOT_WEBHOOK_ADMITTED/,
);

assert.match(
  migration,
  /MESSAGE_ROUND_NOT_ASSIGNED/,
);

assert.match(
  migration,
  /ROUND_BUSINESS_DATE_MISMATCH/,
);

console.log(
  "PASS DR1D-B-10: accepted-message canonical persistence isolated",
);


// B-11: bypass is transaction-local + message-specific.
assert.match(
  migration,
  /set_config\(\s*'line_order\.accepted_message_persistence_id'[\s\S]*p_message_id::text[\s\S]*true/i,
);

assert.match(
  migration,
  /current_setting\(\s*'line_order\.accepted_message_persistence_id'[\s\S]*true/i,
);

assert.match(
  migration,
  /v_admitted_message_id[\s\S]*new\.message_record_id::text/,
);

console.log(
  "PASS DR1D-B-11: bypass is transaction-local and message-specific",
);


// B-12: ordinary canonical mutation retains S1 guard.
assert.match(
  migration,
  /is_settlement_summary_group_accepting\(/,
);

assert.match(
  migration,
  /raise exception\s+'SUMMARY_GROUP_CLOSED'/i,
);

assert.match(
  s1Migration,
  /SETTLEMENT_SUMMARY_GROUP_CONTROL/,
);

console.log(
  "PASS DR1D-B-12: ordinary closed-group canonical guard retained",
);


// B-13: CLOSED Human Verification remains immutable canonical.
assert.match(
  verificationMigration,
  /v_latest_round_status\s*=\s*'CLOSED'/i,
);

assert.match(
  verificationMigration,
  /canonical_mutation_applied/i,
);

assert.match(
  verificationMigration,
  /CLOSED canonical rows remain immutable/i,
);

console.log(
  "PASS DR1D-B-13: CLOSED Human Verification safety unchanged",
);


// B-14: UNSEND stays separate.
assert.match(
  webhook,
  /else if\s*\(event\.type\s*===\s*"unsend"\)[\s\S]*handleUnsend/,
);

console.log(
  "PASS DR1D-B-14: UNSEND remains separately handled",
);


console.log(
  "PASS: DR1D-B ROUND-OWNED MESSAGE ADMISSION CONTRACT",
);
