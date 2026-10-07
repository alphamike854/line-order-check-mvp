import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/"
      + "20261007093000_"
      + "add_retention_current_round_fence.sql",
    "utf8",
  );

const webhook =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const imageWorker =
  fs.readFileSync(
    "netlify/functions/line-image-media-qstash.mjs",
    "utf8",
  );

const qstashConsumer =
  fs.readFileSync(
    "netlify/functions/line-webhook-qstash.mjs",
    "utf8",
  );

function section(source, start, end = null) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);

  if (!end) return source.slice(from);

  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing section end: ${end}`);

  return source.slice(from, to);
}

assert.match(
  migration,
  /webhook_events[\s\S]*summary_group_round_id uuid/i,
);

assert.match(
  migration,
  /update\s+public\.webhook_events w[\s\S]*from\s+public\.messages m/i,
);

assert.match(
  migration,
  /summary_group_round_runtime_state state[\s\S]*state\.latest_round_id\s*=\s*m\.summary_group_round_id/i,
);

console.log(
  "PASS R2-01: ingress/resume is runtime-latest Round scoped",
);

const claimFn =
  section(
    migration,
    "create or replace function\n"
      + "  public.claim_current_round_webhook_event",
    "comment on function\n"
      + "  public.claim_current_round_webhook_event",
  );

const lifecycleLock =
  claimFn.indexOf(
    "LINE_ORDER_SETTLEMENT_OPEN_CLOSE",
  );

const nestedClaim =
  claimFn.indexOf(
    "public.claim_webhook_event(",
  );

assert.ok(
  lifecycleLock >= 0
  && nestedClaim > lifecycleLock,
);

assert.match(
  claimFn,
  /'state', 'RETIRED'[\s\S]*'reason', 'ROUND_RETIRED'/,
);

assert.match(
  claimFn,
  /UNSEND_ORIGINAL_NOT_CURRENT/,
);

assert.match(
  claimFn,
  /state\.latest_round_id\s*=\s*m\.summary_group_round_id/i,
);

assert.match(
  claimFn,
  /summary_group_round_id\s*=\s*[\s\S]*v_round_id/i,
);

console.log(
  "PASS R2-02: retired message/UNSEND returns before webhook claim write",
);

const insertFn =
  section(
    migration,
    "create or replace function\n"
      + "  public.assign_message_to_open_settlement",
    "comment on function\n"
      + "  public.assign_message_to_open_settlement",
  );

assert.match(
  insertFn,
  /summary_group_round_runtime_state state/,
);

assert.match(
  insertFn,
  /state\.latest_round_id\s*=\s*v_round\.id/i,
);

assert.match(
  insertFn,
  /SUMMARY_GROUP_ROUND_RETIRED/,
);

assert.ok(
  insertFn.indexOf(
    "LINE_ORDER_SETTLEMENT_OPEN_CLOSE",
  )
  < insertFn.indexOf(
    "SUMMARY_GROUP_ROUND_RETIRED",
  ),
);

console.log(
  "PASS R2-03: authoritative message INSERT rejects retired explicit Round",
);

assert.match(
  webhook,
  /claim_current_round_webhook_event/,
);

assert.match(
  webhook,
  /p_summary_group_round_id:\s*[\s\S]*summaryGroupRoundId/,
);

assert.match(
  webhook,
  /p_unsend_message_id:\s*[\s\S]*event\.unsend\?\.messageId/,
);

const processFn =
  section(
    webhook,
    "export async function processEvent(",
    "export default async (req) =>",
  );

const claimCall =
  processFn.indexOf(
    "await claimWebhookEvent(",
  );

const retiredReturn =
  processFn.indexOf(
    'claim?.state === "RETIRED"',
  );

const messageLookup =
  processFn.indexOf(
    "findMessageByWebhookEvent(",
  );

assert.ok(
  claimCall >= 0
  && retiredReturn > claimCall
  && messageLookup > retiredReturn,
);

assert.match(
  processFn,
  /skipped:\s*\n\s*"RETIRED_ROUND"/,
);

console.log(
  "PASS R2-04: consumer ACK/DROP decision occurs before message business reads",
);

const unsendFn =
  section(
    webhook,
    "async function handleUnsend(",
    "export async function processEvent(",
  );

assert.match(
  unsendFn,
  /expectedMessageRecordId/,
);

assert.match(
  unsendFn,
  /isCurrentSummaryGroupRound\(/,
);

assert.match(
  unsendFn,
  /UNSEND_ORIGINAL_NOT_CURRENT/,
);

assert.match(
  unsendFn,
  /matched_message_record_id:\s*\n\s*message\.id/,
);

assert.doesNotMatch(
  unsendFn,
  /matched_message_record_id:\s*message\?\.id\s*\?\?\s*null/,
);

console.log(
  "PASS R2-05: unmatched/retired UNSEND cannot create unmatched audit row",
);

const imageJob =
  section(
    webhook,
    "export async function processImageMediaJob({",
    "async function loadImageOcrCheckpoint(",
  );

assert.match(
  imageJob,
  /summaryGroupRoundId/,
);

assert.match(
  imageJob,
  /isCurrentSummaryGroupRound\(/,
);

assert.match(
  imageJob,
  /RETIRED_ROUND/,
);

assert.match(
  imageJob,
  /IMAGE_MEDIA_MESSAGE_NOT_FOUND/,
);

assert.ok(
  imageJob.indexOf(
    "RETIRED_ROUND",
  )
  < imageJob.indexOf(
    "IMAGE_MEDIA_MESSAGE_NOT_FOUND",
  ),
);

assert.match(
  imageJob,
  /IMAGE_MEDIA_ROUND_ID_MISMATCH/,
);

console.log(
  "PASS R2-06: image-media worker ACK/DROP fence precedes missing-message retry",
);

assert.match(
  imageWorker,
  /payload\?\.summary_group_round_id/,
);

assert.match(
  imageWorker,
  /summaryGroupRoundId,/,
);

assert.match(
  qstashConsumer,
  /result\?\.skipped\s*===\s*"EVENT_IN_FLIGHT"/,
);

assert.doesNotMatch(
  qstashConsumer,
  /RETIRED_ROUND_RETRY/,
);

console.log(
  "PASS R2-07: QStash RETIRED result remains HTTP-200 while IN_FLIGHT stays retryable",
);

assert.doesNotMatch(
  migration,
  /\bdelete\s+from\b/i,
);

assert.doesNotMatch(
  migration,
  /\btruncate\b/i,
);

assert.doesNotMatch(
  migration,
  /\bdrop\s+table\b/i,
);

assert.doesNotMatch(
  migration,
  /set_settlement_summary_group_accepting\s*\(/i,
);

console.log(
  "PASS R2-08: R2 performs no purge and does not replace OPEN/CLOSE lifecycle",
);

assert.match(
  migration,
  /latest CLOSED remains retryable until a successor opens/i,
);

assert.match(
  webhook,
  /SUMMARY_GROUP_ROUND_RETIRED/,
);

console.log(
  "PASS R2-09: latest CLOSED compatibility retained; successor makes prior Round retired",
);

assert.match(
  migration,
  /Intentionally no FK/i,
);

assert.match(
  migration,
  /webhook_events_summary_group_round_idx/,
);

console.log(
  "PASS R2-10: webhook transport ownership is available for later R3 purge",
);

console.log(
  "PASS: Retention R2 Current-Round / QStash / UNSEND Fence",
);
