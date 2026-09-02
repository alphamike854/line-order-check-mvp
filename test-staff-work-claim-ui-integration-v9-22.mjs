import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";

const app =
  await readFile(
    "public/app.js",
    "utf8",
  );

const claimApi =
  await readFile(
    "netlify/functions/staff-work-claim.mjs",
    "utf8",
  );


function functionBlock(
  source,
  startMarker,
  endMarker,
) {
  const start =
    source.indexOf(
      startMarker,
    );

  assert.notEqual(
    start,
    -1,
    `missing start marker: ${startMarker}`,
  );

  const end =
    source.indexOf(
      endMarker,
      start
      + startMarker.length,
    );

  assert.notEqual(
    end,
    -1,
    `missing end marker: ${endMarker}`,
  );

  return source.slice(
    start,
    end,
  );
}


// ============================================================
// Review + Workbench read integration
// ============================================================

const loadReviewsBlock =
  functionBlock(
    app,
    "async function loadReviews() {",
    "async function loadUnsends() {",
  );

assert.match(
  loadReviewsBlock,
  /\/api\/reviews\?/,
  "R2D2B2-01 original Review read model remains present",
);

assert.match(
  loadReviewsBlock,
  /\/api\/staff-workbench\?/,
  "R2D2B2-02 Review loads Staff Workbench ownership state",
);

assert.match(
  loadReviewsBlock,
  /Promise\.all/,
  "R2D2B2-03 Review + Workbench reads happen together",
);

assert.match(
  loadReviewsBlock,
  /workByReviewId/,
  "R2D2B2-04 Workbench rows are joined by Review identity",
);

assert.match(
  loadReviewsBlock,
  /String\(\s*item\.review_id\s*,?\s*\)/,
  "R2D2B2-05 Workbench Review ID is normalized for the join",
);

assert.match(
  loadReviewsBlock,
  /Boolean\([\s\S]*?workbenchPayload[\s\S]*?actor[\s\S]*?staff_id/,
  "R2D2B2-06 real Staff mode is detected from trusted Workbench actor",
);

assert.match(
  loadReviewsBlock,
  /if\s*\(\s*realStaff\s*\)[\s\S]*?items\s*=[\s\S]*?items\.filter/,
  "R2D2B2-07 real Staff visibility is limited to Workbench scope",
);

assert.match(
  loadReviewsBlock,
  /workByReviewId\.has\([\s\S]*?String\(item\.id\)/,
  "R2D2B2-08 Staff Review rows must exist in current Workbench scope",
);

assert.match(
  loadReviewsBlock,
  /reviewImageEvidenceHtml\(item\)/,
  "R2D2B2-09 existing Review image evidence remains rendered",
);

assert.match(
  loadReviewsBlock,
  /reviewReasonsHtml\(item\)/,
  "R2D2B2-10 existing Review reason metadata remains rendered",
);

assert.match(
  loadReviewsBlock,
  /Parser เดิม \$\{escapeHtml\(item\.parser_version \|\| "ไม่ระบุ"\)\}/,
  "R2D2B2-11 existing parser-version UI contract remains intact",
);


// ============================================================
// Claim-state presentation
// ============================================================

assert.match(
  app,
  /function reviewClaimStatusHtml\(/,
  "R2D2B2-12 claim-state renderer exists",
);

assert.match(
  app,
  /claimState === "MINE"/,
  "R2D2B2-13 own claim is rendered explicitly",
);

assert.match(
  app,
  /claimState === "AVAILABLE"/,
  "R2D2B2-14 available claim state is rendered explicitly",
);

assert.match(
  app,
  /"CLAIMED_BY_OTHER"/,
  "R2D2B2-15 another Staff ownership state is rendered explicitly",
);

assert.match(
  app,
  /รับรายการ/,
  "R2D2B2-16 available work exposes Claim action",
);

assert.match(
  app,
  /ต่อเวลา/,
  "R2D2B2-17 own work exposes lease renewal",
);

assert.match(
  app,
  /คืนรายการ/,
  "R2D2B2-18 own work exposes release action",
);

assert.match(
  app,
  /claimed_by_display_name/,
  "R2D2B2-19 competing claim holder identity is shown safely",
);


// ============================================================
// Local card ownership guards
// ============================================================

const previewBlock =
  functionBlock(
    app,
    "async function previewReview(event) {",
    "function removeCompletedReviewCard(card) {",
  );

assert.match(
  previewBlock,
  /reviewCardCanMutate\(card\)/,
  "R2D2B2-20 preview requires Staff to own the claim",
);


const applyBlock =
  functionBlock(
    app,
    "async function applyReview(card) {",
    "async function ignoreReview(event) {",
  );

assert.match(
  applyBlock,
  /reviewCardCanMutate\(card\)/,
  "R2D2B2-21 apply requires Staff to own the claim",
);


const ignoreBlock =
  functionBlock(
    app,
    "async function ignoreReview(event) {",
    "async function loadReviews() {",
  );

assert.match(
  ignoreBlock,
  /reviewCardCanMutate\(card\)/,
  "R2D2B2-22 ignore requires Staff to own the claim",
);


// ============================================================
// Mutation request contract
// ============================================================

const mutateBlock =
  functionBlock(
    app,
    "async function mutateReviewClaim(",
    "async function releaseReviewClaimAfterCompletion(",
  );

assert.match(
  mutateBlock,
  /\/api\/staff-work-claim/,
  "R2D2B2-23 Claim/Renew/Release uses Staff claim endpoint",
);

assert.match(
  mutateBlock,
  /message_record_id/,
  "R2D2B2-24 mutation uses canonical message identity",
);

assert.match(
  mutateBlock,
  /lease_seconds\s*=\s*300/,
  "R2D2B2-25 Claim/Renew requests bounded five-minute lease",
);

assert.match(
  mutateBlock,
  /lease_version/,
  "R2D2B2-26 Release sends expected lease version",
);


const bodyStart =
  mutateBlock.indexOf(
    "const body = {",
  );

const bodyEnd =
  mutateBlock.indexOf(
    "const payload =",
    bodyStart,
  );

assert.notEqual(
  bodyStart,
  -1,
  "R2D2B2-27 mutation request body exists",
);

assert.notEqual(
  bodyEnd,
  -1,
  "R2D2B2-28 mutation request body boundary exists",
);

const requestBody =
  mutateBlock.slice(
    bodyStart,
    bodyEnd,
  );

assert.doesNotMatch(
  requestBody,
  /\bstaff_id\b/,
  "R2D2B2-29 browser cannot choose Staff claim owner",
);

assert.doesNotMatch(
  requestBody,
  /\bsettlement_session_id\b/,
  "R2D2B2-30 browser cannot choose Settlement claim boundary",
);


// ============================================================
// Card-local state refresh
// ============================================================

assert.match(
  app,
  /async function refreshReviewClaimState\(/,
  "R2D2B2-31 card-level claim refresh exists",
);

assert.match(
  app,
  /refreshReviewClaimState\([\s\S]*?card/,
  "R2D2B2-32 claim conflict can refresh one card state",
);

assert.match(
  app,
  /function syncReviewCardClaimUi\(/,
  "R2D2B2-33 claim mutation updates card UI locally",
);


// ============================================================
// Completed Review cleanup
// ============================================================

const removeBlock =
  functionBlock(
    app,
    "function removeCompletedReviewCard(card) {",
    "async function applyReview(card) {",
  );

assert.match(
  removeBlock,
  /releaseReviewClaimAfterCompletion\(card\)/,
  "R2D2B2-34 completed Review attempts claim release",
);


const releaseCompletionBlock =
  functionBlock(
    app,
    "async function releaseReviewClaimAfterCompletion(",
    "function onReviewEditorInput(event) {",
  );

assert.match(
  releaseCompletionBlock,
  /action:\s*"RELEASE"/,
  "R2D2B2-35 completion cleanup uses RELEASE",
);

assert.match(
  releaseCompletionBlock,
  /lease_version/,
  "R2D2B2-36 completion cleanup protects against stale lease version",
);

assert.match(
  releaseCompletionBlock,
  /catch\s*\(error\)/,
  "R2D2B2-37 completion release remains best-effort",
);


// ============================================================
// Claim API conflict contract
// ============================================================

assert.match(
  claimApi,
  /result\?\.status === "BUSY"/,
  "R2D2B2-38 concurrent Claim returns BUSY conflict",
);

assert.match(
  claimApi,
  /result\?\.status === "CLAIM_OWNED_BY_OTHER"/,
  "R2D2B2-39 release by another Staff remains conflict",
);

assert.match(
  claimApi,
  /result\?\.status === "STALE_CLAIM_VERSION"/,
  "R2D2B2-40 stale release version remains conflict",
);

assert.match(
  claimApi,
  /error:[\s\S]*?result\?\.status[\s\S]*?\?\? "CLAIM_CONFLICT"/,
  "R2D2B2-41 generic browser API receives explicit conflict error",
);

assert.match(
  claimApi,
  /409/,
  "R2D2B2-42 claim ownership conflicts use HTTP 409",
);


// ============================================================
// Server-trusted Staff + Settlement boundaries remain intact
// ============================================================

assert.match(
  claimApi,
  /staffId:[\s\S]*?auth\.actor\.staff_id/,
  "R2D2B2-43 claim owner comes from authenticated Staff actor",
);

assert.match(
  claimApi,
  /settlementSessionId:[\s\S]*?session\.id/,
  "R2D2B2-44 Settlement identity is resolved server-side",
);

assert.doesNotMatch(
  claimApi,
  /body\?\.staff_id/,
  "R2D2B2-45 API never accepts browser-selected Staff owner",
);

assert.doesNotMatch(
  claimApi,
  /body\?\.settlement_session_id/,
  "R2D2B2-46 API never accepts browser-selected Settlement identity",
);


console.log(
  "PASS: R2D2B Claim/Renew/Release Review Workbench Integration",
);
