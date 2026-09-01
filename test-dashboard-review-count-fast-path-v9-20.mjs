import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(
  "src/lib/dashboard-api.mjs",
  "utf8"
);

const dashboard = fs.readFileSync(
  "netlify/functions/dashboard.mjs",
  "utf8"
);

const reviewsEndpoint = fs.readFileSync(
  "netlify/functions/reviews.mjs",
  "utf8"
);

// RC-01: Review Workbench detail loader must remain.
assert.match(
  api,
  /export async function fetchOpenReviews\(/
);

assert.match(
  reviewsEndpoint,
  /fetchOpenReviews/
);

console.log(
  "PASS RC-01: detailed Review Workbench loader preserved"
);

// RC-02: Dashboard count helper must exist.
assert.match(
  api,
  /export async function fetchOpenReviewCount\(/
);

console.log(
  "PASS RC-02: lightweight review count helper exists"
);

// RC-03: Count helper must preserve business-date scope.
const countStart = api.indexOf(
  "export async function fetchOpenReviewCount("
);

const countEnd = api.indexOf(
  "export async function fetchUnsends(",
  countStart
);

assert.ok(countStart >= 0);
assert.ok(countEnd > countStart);

const countPath = api.slice(
  countStart,
  countEnd
);

assert.match(
  countPath,
  /\.eq\("business_date", businessDate\)/
);

assert.match(
  countPath,
  /"settlement_session_id"/
);

assert.match(
  countPath,
  /"summary_group_id"/
);

console.log(
  "PASS RC-03: count scope preserves date/session/group filters"
);

// RC-04: Messages must be ID-only for Dashboard count.
assert.match(
  countPath,
  /\.from\("messages"\)[\s\S]*?\.select\("id"\)/
);

console.log(
  "PASS RC-04: Dashboard review count loads message IDs only"
);

// RC-05: OPEN reviews must use exact count, not row payload.
assert.match(
  countPath,
  /count:\s*"exact"/
);

assert.match(
  countPath,
  /head:\s*true/
);

assert.match(
  countPath,
  /\.eq\("status", "OPEN"\)/
);

console.log(
  "PASS RC-05: OPEN reviews use exact head-only count"
);

// RC-06: Count queries must use bounded concurrency.
assert.match(
  countPath,
  /REVIEW_COUNT_CONCURRENCY = 8/
);

assert.match(
  countPath,
  /await Promise\.all\(/
);

console.log(
  "PASS RC-06: review counts use bounded parallel batches"
);

// RC-07: Dashboard must not load detailed reviews.
assert.match(
  dashboard,
  /fetchOpenReviewCount/
);

assert.doesNotMatch(
  dashboard,
  /fetchOpenReviews/
);

assert.match(
  dashboard,
  /review_open:Number\(reviewOpenCount\|\|0\)/
);

console.log(
  "PASS RC-07: Dashboard uses count-only review path"
);

console.log(
  "PASS: Dashboard review-count fast path v9.20"
);
