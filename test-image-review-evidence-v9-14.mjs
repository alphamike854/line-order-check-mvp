"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const webhook =
  fs.readFileSync(
    new URL(
      "./netlify/functions/line-webhook.mjs",
      import.meta.url,
    ),
    "utf8",
  );

const migration =
  fs.readFileSync(
    new URL(
      "./supabase/migrations/20260831010000_add_review_image_evidence.sql",
      import.meta.url,
    ),
    "utf8",
  );

// ============================================================
// R3A-01 database/storage foundation
// ============================================================

assert.match(
  migration,
  /image_storage_path\s+text/,
);

assert.match(
  migration,
  /image_stored_at\s+timestamptz/,
);

assert.match(
  migration,
  /image_deleted_at\s+timestamptz/,
);

assert.match(
  migration,
  /'review-images'[\s\S]*?'review-images'[\s\S]*?false[\s\S]*?15728640/,
);

console.log(
  "PASS R3A-01 private image evidence foundation",
);

// ============================================================
// Locate image handler
// ============================================================

const imageStart =
  webhook.indexOf(
    "async function handleImageMessage(",
  );

const unsendStart =
  webhook.indexOf(
    "async function handleUnsend(",
    imageStart,
  );

assert.ok(
  imageStart >= 0,
  "handleImageMessage must exist",
);

assert.ok(
  unsendStart > imageStart,
  "handleUnsend must follow image handler",
);

const imageHandler =
  webhook.slice(
    imageStart,
    unsendStart,
  );

// ============================================================
// R3A-02 evidence storage helper
// ============================================================

assert.match(
  webhook,
  /const REVIEW_IMAGE_BUCKET = "review-images";/,
);

assert.match(
  webhook,
  /async function storeImageReviewEvidence\(message, image\)/,
);

assert.match(
  webhook,
  /const storagePath = String\(message\.id\);/,
);

assert.match(
  webhook,
  /\.from\(REVIEW_IMAGE_BUCKET\)[\s\S]*?\.upload\([\s\S]*?upsert:\s*true/,
);

assert.match(
  webhook,
  /image_storage_path:\s*storagePath/,
);

assert.match(
  webhook,
  /image_stored_at:\s*storedAt/,
);

assert.match(
  webhook,
  /image_deleted_at:\s*null/,
);

console.log(
  "PASS R3A-02 deterministic retry-safe evidence storage",
);

// ============================================================
// R3A-03 DO NOT archive every image before OCR
// ============================================================

const downloadIndex =
  imageHandler.indexOf(
    "image = await downloadLineImage(",
  );

const ocrIndex =
  imageHandler.indexOf(
    "ocr = await transcribeOrderImage({",
  );

assert.ok(
  downloadIndex >= 0,
  "LINE image download must exist",
);

assert.ok(
  ocrIndex > downloadIndex,
  "OCR must follow image download",
);

const betweenDownloadAndOcr =
  imageHandler.slice(
    downloadIndex,
    ocrIndex,
  );

assert.doesNotMatch(
  betweenDownloadAndOcr,
  /storeImageReviewEvidence/,
  "normal images must not be archived before OCR",
);

console.log(
  "PASS R3A-03 normal images are not archived before OCR",
);

// ============================================================
// R3A-04 retry attempts 1-2 must escape before evidence storage
// ============================================================

const retryBranchIndex =
  imageHandler.indexOf(
    "&& Number(processingAttempt || 1) < 3",
  );

const retryThrowIndex =
  imageHandler.indexOf(
    "throw error;",
    retryBranchIndex,
  );

const finalEvidenceIndex =
  imageHandler.indexOf(
    "await storeImageReviewEvidence(",
    retryThrowIndex,
  );

assert.ok(
  retryBranchIndex >= 0,
  "bounded webhook retry branch must exist",
);

assert.ok(
  retryThrowIndex > retryBranchIndex,
  "retry branch must throw",
);

assert.ok(
  finalEvidenceIndex > retryThrowIndex,
  "review evidence must only occur after retry branch exits",
);

console.log(
  "PASS R3A-04 transient OCR retries do not create evidence",
);

// ============================================================
// R3A-05 final OCR failure stores evidence before Review
// ============================================================

const finalReviewUpdateIndex =
  imageHandler.indexOf(
    'parse_status: "REVIEW"',
    finalEvidenceIndex,
  );

const imageOcrFailedIndex =
  imageHandler.indexOf(
    'code: "IMAGE_OCR_FAILED"',
    finalEvidenceIndex,
  );

assert.ok(
  finalEvidenceIndex >= 0,
  "final OCR failure evidence storage must exist",
);

assert.ok(
  finalReviewUpdateIndex > finalEvidenceIndex,
  "evidence must be stored before final OCR Review message update",
);

assert.ok(
  imageOcrFailedIndex > finalEvidenceIndex,
  "evidence must be stored before IMAGE_OCR_FAILED Review",
);

console.log(
  "PASS R3A-05 final OCR failure preserves image evidence",
);

// ============================================================
// R3A-06 OCR UNCERTAIN stores evidence
// ============================================================

const uncertainIndex =
  imageHandler.indexOf(
    "if (ocr.uncertain) {",
  );

const uncertainEvidenceIndex =
  imageHandler.indexOf(
    "await storeImageReviewEvidence(",
    uncertainIndex,
  );

const uncertainReviewIndex =
  imageHandler.indexOf(
    'code: "OCR_UNCERTAIN"',
    uncertainIndex,
  );

assert.ok(
  uncertainIndex >= 0,
);

assert.ok(
  uncertainEvidenceIndex > uncertainIndex,
);

assert.ok(
  uncertainReviewIndex > uncertainEvidenceIndex,
);

console.log(
  "PASS R3A-06 OCR uncertainty preserves image evidence",
);

// ============================================================
// R3A-07 parser REVIEW / PARTIAL only
// ============================================================

assert.match(
  imageHandler,
  /const parserNeedsHumanReview =[\s\S]*?\["REVIEW", "PARTIAL"\]\.includes\(result\.status\)/,
);

assert.match(
  imageHandler,
  /result\.status === "PARSED"[\s\S]*?!\(result\.items \?\? \[\]\)\.length/,
);

const parserGuardIndex =
  imageHandler.indexOf(
    "if (parserNeedsHumanReview) {",
  );

const parserEvidenceIndex =
  imageHandler.indexOf(
    "await storeImageReviewEvidence(",
    parserGuardIndex,
  );

const persistIndex =
  imageHandler.indexOf(
    "return persistParsedResult(",
    parserGuardIndex,
  );

assert.ok(
  parserGuardIndex >= 0,
);

assert.ok(
  parserEvidenceIndex > parserGuardIndex,
);

assert.ok(
  persistIndex > parserEvidenceIndex,
);

console.log(
  "PASS R3A-07 parser human-review results preserve evidence",
);

// ============================================================
// R3A-08 normal PARSED / IGNORE path has no unconditional store
// ============================================================

const parserResultIndex =
  imageHandler.indexOf(
    "const result = parseOrder(ocr.text, config);",
  );

const parserToPersist =
  imageHandler.slice(
    parserResultIndex,
    persistIndex,
  );

const storeOccurrences =
  (
    parserToPersist.match(
      /storeImageReviewEvidence/g,
    )
    ?? []
  ).length;

assert.equal(
  storeOccurrences,
  1,
  "parser path must have exactly one guarded evidence call",
);

console.log(
  "PASS R3A-08 PARSED/IGNORE remain non-archived",
);

// ============================================================
// R3A-09 UNSEND deletes evidence
// ============================================================

const processStart =
  webhook.indexOf(
    "export async function processEvent(",
    unsendStart,
  );

const unsend =
  webhook.slice(
    unsendStart,
    processStart,
  );

assert.match(
  unsend,
  /\.select\("id,line_group_id,image_storage_path,image_deleted_at"\)/,
);

assert.match(
  unsend,
  /if \(message\.image_storage_path\)[\s\S]*?\.from\(REVIEW_IMAGE_BUCKET\)[\s\S]*?\.remove\(\[[\s\S]*?message\.image_storage_path/,
);

assert.match(
  unsend,
  /image_storage_path:\s*null/,
);

assert.match(
  unsend,
  /image_deleted_at:[\s\S]*?message\.image_storage_path[\s\S]*?\? unsentAt[\s\S]*?: message\.image_deleted_at \?\? null/,
);

console.log(
  "PASS R3A-09 UNSEND deletes temporary evidence",
);

console.log(
  "PASS: Image Review selective evidence R3A v9.14",
);
