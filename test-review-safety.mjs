import assert from "node:assert/strict";
import {
  createReviewPreviewToken,
  reviewPreviewFingerprint,
  verifyReviewPreviewToken,
} from "./src/lib/review-safety.mjs";

const key = "test-review-preview-signing-key";
const nowMs = Date.parse("2026-08-24T12:00:00.000Z");
const base = {
  reviewId: 77,
  messageRecordId: "791dd70e-4627-43fe-81d8-b4d5c9d6cede",
  correctedText: "124=20x6",
  normalizedText: "124=20x6",
  parserVersion: "1.0.0",
  items: [
    { category: "E", code: "124", quantity: 20 },
    { category: "E", code: "142", quantity: 20 },
    { category: "E", code: "214", quantity: 20 },
    { category: "E", code: "241", quantity: 20 },
    { category: "E", code: "412", quantity: 20 },
    { category: "E", code: "421", quantity: 20 },
  ],
  parserConfig: {
    aliases: { "น": "A" },
    defaultCategoryByCodeLength: { 2: "A", 3: "E" },
  },
  summaryGroupId: "NORTH",
};

const fingerprint = reviewPreviewFingerprint(base);
const signed = createReviewPreviewToken({
  reviewId: base.reviewId,
  messageRecordId: base.messageRecordId,
  fingerprint,
  nowMs,
  ttlSeconds: 900,
  key,
});

assert.equal(
  verifyReviewPreviewToken({
    token: signed.token,
    reviewId: base.reviewId,
    messageRecordId: base.messageRecordId,
    expectedFingerprint: fingerprint,
    nowMs: nowMs + 60_000,
    key,
  }).ok,
  true,
);

const changedTextFingerprint = reviewPreviewFingerprint({ ...base, correctedText: "124=20x6 " });
assert.equal(changedTextFingerprint === fingerprint, false, "exact edited text must invalidate preview");
assert.equal(
  verifyReviewPreviewToken({
    token: signed.token,
    reviewId: base.reviewId,
    messageRecordId: base.messageRecordId,
    expectedFingerprint: changedTextFingerprint,
    nowMs: nowMs + 60_000,
    key,
  }).error,
  "PREVIEW_STALE",
);

const changedItemsFingerprint = reviewPreviewFingerprint({
  ...base,
  items: base.items.map((item, index) => index === 0 ? { ...item, quantity: 30 } : item),
});
assert.equal(
  verifyReviewPreviewToken({
    token: signed.token,
    reviewId: base.reviewId,
    messageRecordId: base.messageRecordId,
    expectedFingerprint: changedItemsFingerprint,
    nowMs: nowMs + 60_000,
    key,
  }).error,
  "PREVIEW_STALE",
);

const changedConfigFingerprint = reviewPreviewFingerprint({
  ...base,
  parserConfig: {
    aliases: { "น": "B" },
    defaultCategoryByCodeLength: { 2: "A", 3: "E" },
  },
});
assert.equal(
  verifyReviewPreviewToken({
    token: signed.token,
    reviewId: base.reviewId,
    messageRecordId: base.messageRecordId,
    expectedFingerprint: changedConfigFingerprint,
    nowMs: nowMs + 60_000,
    key,
  }).error,
  "PREVIEW_STALE",
);

const changedGroupFingerprint = reviewPreviewFingerprint({ ...base, summaryGroupId: "SOUTH" });
assert.equal(
  verifyReviewPreviewToken({
    token: signed.token,
    reviewId: base.reviewId,
    messageRecordId: base.messageRecordId,
    expectedFingerprint: changedGroupFingerprint,
    nowMs: nowMs + 60_000,
    key,
  }).error,
  "PREVIEW_STALE",
);

assert.equal(
  verifyReviewPreviewToken({
    token: signed.token,
    reviewId: base.reviewId,
    messageRecordId: base.messageRecordId,
    expectedFingerprint: fingerprint,
    nowMs: nowMs + 901_000,
    key,
  }).error,
  "PREVIEW_EXPIRED",
);

const tamperedToken = signed.token.slice(0, -1) + (signed.token.endsWith("a") ? "b" : "a");
assert.equal(
  verifyReviewPreviewToken({
    token: tamperedToken,
    reviewId: base.reviewId,
    messageRecordId: base.messageRecordId,
    expectedFingerprint: fingerprint,
    nowMs: nowMs + 60_000,
    key,
  }).error,
  "PREVIEW_TOKEN_INVALID",
);

assert.equal(
  verifyReviewPreviewToken({
    token: "",
    reviewId: base.reviewId,
    messageRecordId: base.messageRecordId,
    expectedFingerprint: fingerprint,
    nowMs,
    key,
  }).error,
  "PREVIEW_REQUIRED",
);

console.log("PASS: Review preview safety smoke tests");
