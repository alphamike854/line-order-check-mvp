import assert from "node:assert/strict";
import fs from "node:fs";

const webhook = fs.readFileSync(
  "netlify/functions/line-webhook.mjs",
  "utf8",
);

const claimMigration = fs.readFileSync(
  "supabase/migrations/20260827051000_add_webhook_retry_claim.sql",
  "utf8",
);

// ------------------------------------------------------------
// Reservation is now resumable claim-based.
// ------------------------------------------------------------

assert.match(webhook, /async function claimWebhookEvent/);
assert.match(webhook, /claim_webhook_event/);
assert.doesNotMatch(webhook, /async function reserveWebhookEvent/);

assert.match(webhook, /claim\?\.state === "DONE"/);
assert.match(webhook, /claim\?\.state === "IN_FLIGHT"/);
assert.match(webhook, /claim\?\.state !== "CLAIMED"/);

// ------------------------------------------------------------
// Retry must reuse an existing message instead of inserting a
// second row for the same webhook_event_id.
// ------------------------------------------------------------

assert.match(webhook, /async function findMessageByWebhookEvent/);
assert.match(webhook, /\.eq\("webhook_event_id", webhookEventId\)/);

assert.match(
  webhook,
  /existingMessage \?\? await createMessage/,
);

// A legacy/broken PARSED + zero order_items is incomplete.
assert.match(webhook, /message\.parse_status === "PARSED"/);
assert.match(webhook, /Number\(count \?\? 0\) > 0/);

// ------------------------------------------------------------
// Failure lifecycle.
// ------------------------------------------------------------

assert.match(webhook, /async function markWebhookFailed/);
assert.match(webhook, /processing_started_at: null/);
assert.match(webhook, /last_error: detail/);

assert.match(webhook, /let processingFailed = false/);
assert.match(webhook, /processingFailed = true/);

assert.match(
  webhook,
  /if \(processingFailed\)[\s\S]*PROCESSING_FAILED[\s\S]*500/,
);

// ------------------------------------------------------------
// Image OCR catch must NOT swallow parser/database persistence
// failures.
// ------------------------------------------------------------

const imageStart = webhook.indexOf(
  "async function handleImageMessage",
);
const imageEnd = webhook.indexOf(
  "async function handleUnsend",
  imageStart,
);

assert.ok(imageStart >= 0);
assert.ok(imageEnd > imageStart);

const imageBody = webhook.slice(imageStart, imageEnd);

const ocrFailureIndex =
  imageBody.indexOf('code: "IMAGE_OCR_FAILED"');
const baseUpdateIndex =
  imageBody.indexOf("const baseUpdate");
const persistIndex =
  imageBody.indexOf("return persistParsedResult");

assert.ok(ocrFailureIndex >= 0);
assert.ok(baseUpdateIndex > ocrFailureIndex);
assert.ok(persistIndex > baseUpdateIndex);

// ------------------------------------------------------------
// Database claim contract.
// ------------------------------------------------------------

assert.match(
  claimMigration,
  /add column if not exists processing_started_at/,
);

assert.match(
  claimMigration,
  /add column if not exists attempt_count/,
);

assert.match(
  claimMigration,
  /add column if not exists last_error/,
);

assert.match(
  claimMigration,
  /create or replace function public\.claim_webhook_event/,
);

assert.match(
  claimMigration,
  /v_event\.processed_at is not null/,
);

assert.match(
  claimMigration,
  /'state', 'DONE'/,
);

assert.match(
  claimMigration,
  /interval '2 minutes'/,
);

assert.match(
  claimMigration,
  /'state', 'IN_FLIGHT'/,
);

assert.match(
  claimMigration,
  /'state', 'CLAIMED'/,
);

assert.match(
  claimMigration,
  /attempt_count = attempt_count \+ 1/,
);

assert.match(
  claimMigration,
  /grant execute on function public\.claim_webhook_event[\s\S]*to service_role/,
);

console.log(
  "PASS: resumable webhook claim + HTTP failure + image persistence separation v8.8",
);
