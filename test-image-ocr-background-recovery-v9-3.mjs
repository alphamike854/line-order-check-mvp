import assert from "node:assert/strict";
import fs from "node:fs";

const webhook = fs.readFileSync(
  "netlify/functions/line-webhook.mjs",
  "utf8",
);

const imageStart = webhook.indexOf(
  "async function handleImageMessage"
);

const imageEnd = webhook.indexOf(
  "async function handleUnsend",
  imageStart,
);

assert.ok(imageStart >= 0);
assert.ok(imageEnd > imageStart);

const imageBody = webhook.slice(
  imageStart,
  imageEnd,
);

// Transient Gemini failures are recognized separately.
assert.match(
  imageBody,
  /isRetryableGeminiOcrError\(error\)/,
);

// Recovery is bounded by webhook claim attempts.
assert.match(
  imageBody,
  /Number\(processingAttempt \|\| 1\) < 3/,
);

// During a recoverable provider outage the message must
// remain incomplete so retry does not skip it.
assert.match(
  imageBody,
  /retryableProviderFailure[\s\S]*parse_status: "PENDING"/,
);

// The transient branch must propagate into processEvent,
// where markWebhookFailed releases the claim.
assert.match(
  imageBody,
  /retryableProviderFailure[\s\S]*throw error;/,
);

// Terminal failure path must remain available after the
// bounded background attempts have been exhausted.
assert.match(
  imageBody,
  /code: "IMAGE_OCR_FAILED"/,
);

assert.match(
  imageBody,
  /status: "REVIEW"[\s\S]*reason: "IMAGE_OCR_FAILED"/,
);

// processEvent passes the claim attempt number to image
// processing so the terminal boundary is deterministic.
assert.match(
  webhook,
  /existingMessage,\s*Number\(claim\?\.attempt_count \?\? 1\)/,
);

// Existing recovery lifecycle remains responsible for
// releasing failed claims.
assert.match(
  webhook,
  /async function markWebhookFailed/,
);

assert.match(
  webhook,
  /processing_started_at: null/,
);

console.log(
  "PASS: image OCR background recovery v9.3"
);
