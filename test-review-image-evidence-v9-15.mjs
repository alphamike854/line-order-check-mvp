"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const dashboardApi =
  fs.readFileSync(
    "src/lib/dashboard-api.mjs",
    "utf8",
  );

const reviewsApi =
  fs.readFileSync(
    "netlify/functions/reviews.mjs",
    "utf8",
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const styles =
  fs.readFileSync(
    "public/styles.css",
    "utf8",
  );

// ============================================================
// R3B-01
// Review read model carries the private evidence path internally.
// ============================================================

const reviewFunction =
  dashboardApi.match(
    /export async function fetchOpenReviews[\s\S]*?export async function fetchUnsends/,
  )?.[0] ?? "";

assert.ok(
  reviewFunction,
  "fetchOpenReviews must exist",
);

assert.match(
  reviewFunction,
  /image_storage_path/,
);

console.log(
  "PASS R3B-01 Review read model carries private evidence metadata",
);

// ============================================================
// R3B-02
// Review API reuses the existing server-side Supabase client.
// ============================================================

assert.match(
  reviewsApi,
  /supabase,/,
);

assert.match(
  reviewsApi,
  /const REVIEW_IMAGE_BUCKET\s*=\s*\n?\s*"review-images";/,
);

console.log(
  "PASS R3B-02 Review API uses private Storage server-side",
);

// ============================================================
// R3B-03
// Signed URL must remain short-lived.
// ============================================================

assert.match(
  reviewsApi,
  /const REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS\s*=\s*\n?\s*900;/,
);

assert.match(
  reviewsApi,
  /\.createSignedUrl\([\s\S]*?storagePath[\s\S]*?REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS/,
);

console.log(
  "PASS R3B-03 Review images use 15-minute signed URLs",
);

// ============================================================
// R3B-04
// Private Storage path is destructured away before response.
// ============================================================

assert.match(
  reviewsApi,
  /image_storage_path:\s*storagePath,[\s\S]*?\.\.\.publicItem/,
);

assert.match(
  reviewsApi,
  /image_evidence_url:/,
);

const finalResponse =
  reviewsApi.slice(
    reviewsApi.indexOf(
      "return json({",
      reviewsApi.indexOf(
        "const publicItems",
      ),
    ),
  );

assert.doesNotMatch(
  finalResponse,
  /image_storage_path/,
  "API response must not explicitly expose private object paths",
);

console.log(
  "PASS R3B-04 browser receives signed URL instead of Storage path",
);

// ============================================================
// R3B-05
// Signing errors must be isolated from the Review list.
// ============================================================

assert.match(
  reviewsApi,
  /review image signing failed/,
);

const nullEvidenceMatches =
  reviewsApi.match(
    /image_evidence_url:\s*null/g,
  ) ?? [];

assert.ok(
  nullEvidenceMatches.length >= 2,
  "missing evidence and signing failure must both fall back safely",
);

assert.match(
  reviewsApi,
  /catch \(error\)[\s\S]*?image_evidence_url:\s*null/,
);

console.log(
  "PASS R3B-05 image signing failure does not fail Review workbench",
);

// ============================================================
// R3B-06
// Access check remains before Review data/signing work.
// ============================================================

const handlerIndex =
  reviewsApi.indexOf(
    "export default async function handler(req)",
  );

assert.ok(
  handlerIndex >= 0,
  "Review endpoint handler must exist",
);

const handlerSource =
  reviewsApi.slice(handlerIndex);

const deniedIndex =
  handlerSource.indexOf(
    "requireDashboardAccess(req)",
  );

const evidenceIndex =
  handlerSource.indexOf(
    "await addReviewImageEvidence(items)",
  );

assert.ok(
  deniedIndex >= 0,
  "Review endpoint must require dashboard access",
);

assert.ok(
  evidenceIndex > deniedIndex,
  "signed evidence must only be produced after access validation",
);

console.log(
  "PASS R3B-06 evidence signing remains behind dashboard access",
);

// ============================================================
// R3B-07
// Historical/text Reviews without evidence remain unchanged.
// ============================================================

assert.match(
  app,
  /if \(!item\.image_evidence_url\) \{[\s\S]*?return "";/,
);

console.log(
  "PASS R3B-07 Reviews without evidence retain normal UI",
);

// ============================================================
// R3B-08
// Signed URL is escaped before insertion into HTML.
// ============================================================

assert.match(
  app,
  /function reviewImageEvidenceHtml\(item\)/,
);

assert.match(
  app,
  /escapeHtml\(item\.image_evidence_url\)/,
);

assert.match(
  app,
  /class="review-evidence-image"/,
);

assert.match(
  app,
  /loading="lazy"/,
);

assert.match(
  app,
  /target="_blank"/,
);

assert.match(
  app,
  /rel="noopener noreferrer"/,
);

console.log(
  "PASS R3B-08 Review card renders safe clickable thumbnail",
);

// ============================================================
// R3B-09
// Review card integrates evidence as an additive element only.
// ============================================================

assert.match(
  app,
  /\$\{reviewImageEvidenceHtml\(item\)\}/,
);

assert.match(
  app,
  /class="review-editor"/,
);

assert.match(
  app,
  /class="button primary small preview-review"/,
);

assert.match(
  app,
  /class="button ghost small ignore-review"/,
);

console.log(
  "PASS R3B-09 existing Review correction workflow remains present",
);

// ============================================================
// R3B-10
// Thumbnail layout is bounded and responsive.
// ============================================================

assert.match(
  styles,
  /\.review-evidence\s*\{/,
);

assert.match(
  styles,
  /\.review-evidence-image\s*\{/,
);

assert.match(
  styles,
  /max-width:\s*min\(100%,\s*420px\)/,
);

assert.match(
  styles,
  /max-height:\s*260px/,
);

assert.match(
  styles,
  /object-fit:\s*contain/,
);

console.log(
  "PASS R3B-10 Review evidence thumbnail is bounded",
);

// ============================================================
// R3B-11
// Private Review bucket must never use a public URL.
// ============================================================

assert.doesNotMatch(
  reviewsApi,
  /getPublicUrl/,
);

assert.doesNotMatch(
  reviewsApi,
  /publicUrl/,
);

console.log(
  "PASS R3B-11 private Review bucket never uses public URLs",
);

console.log(
  "PASS: Review signed image evidence UI R3B v9.15",
);
