import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";


const endpoint =
  await readFile(
    "netlify/functions/review-resolve.mjs",
    "utf8",
  );

const app =
  await readFile(
    "public/app.js",
    "utf8",
  );


assert.match(
  endpoint,
  /x-staff-key/,
  "R2D2C2-01 Resolve detects explicit Staff credential mode",
);

assert.match(
  endpoint,
  /authenticateWorkbenchActor/,
  "R2D2C2-02 Staff identity is authenticated server-side",
);

assert.match(
  endpoint,
  /requireDashboardAccess/,
  "R2D2C2-03 legacy Dashboard auth remains",
);

assert.match(
  endpoint,
  /fetchOpenSettlementSession/,
  "R2D2C2-04 current Settlement is resolved server-side",
);

assert.match(
  endpoint,
  /loadActorSessionLineGroupIds/,
  "R2D2C2-05 Staff assignment scope is resolved server-side",
);

assert.match(
  endpoint,
  /loadStaffReviewPreviewAccess/,
  "R2D2C2-06 pre-mutation Staff scope uses targeted review boundary",
);

assert.match(
  endpoint,
  /normalizeLeaseVersion[\s\S]*?body\.lease_version/,
  "R2D2C2-07 expected lease version comes from Staff request",
);

assert.match(
  endpoint,
  /LEASE_VERSION_REQUIRED[\s\S]*?428/,
  "R2D2C2-08 Staff mutation requires lease precondition",
);

assert.match(
  endpoint,
  /resolve_staff_review_with_preview/,
  "R2D2C2-09 Staff CORRECT uses atomic guarded RPC",
);

assert.match(
  endpoint,
  /ignore_staff_review/,
  "R2D2C2-10 Staff IGNORE uses atomic guarded RPC",
);

assert.match(
  endpoint,
  /resolve_review_with_preview/,
  "R2D2C2-11 legacy Dashboard CORRECT RPC remains",
);

assert.match(
  endpoint,
  /ignore_review/,
  "R2D2C2-12 legacy Dashboard IGNORE RPC remains",
);

assert.match(
  endpoint,
  /p_expected_lease_version:[\s\S]*?expectedLeaseVersion/,
  "R2D2C2-13 Staff RPC receives exact expected lease version",
);

assert.match(
  endpoint,
  /p_staff_id:[\s\S]*?staffContext[\s\S]*?actor[\s\S]*?staff_id/,
  "R2D2C2-14 Staff identity is injected from authenticated actor",
);

assert.match(
  endpoint,
  /p_settlement_session_id:[\s\S]*?staffContext[\s\S]*?session[\s\S]*?id/,
  "R2D2C2-15 Settlement identity is injected server-side",
);

assert.doesNotMatch(
  endpoint,
  /body\??\.staff_id|body\.staff_id/,
  "R2D2C2-16 browser cannot select Staff identity",
);

assert.doesNotMatch(
  endpoint,
  /body\??\.settlement_session_id|body\.settlement_session_id/,
  "R2D2C2-17 browser cannot select Settlement identity",
);

assert.match(
  endpoint,
  /claim_conflict/,
  "R2D2C2-18 claim conflicts are explicit in API response",
);

assert.match(
  endpoint,
  /STALE_CLAIM_VERSION/,
  "R2D2C2-19 stale-tab conflict is mapped",
);

assert.match(
  endpoint,
  /CLAIM_EXPIRED/,
  "R2D2C2-20 expired lease conflict is mapped",
);

assert.match(
  endpoint,
  /staffResolvedBy/,
  "R2D2C2-21 Staff audit identity is distinct from Dashboard operator",
);


// ============================================================
// UI lease forwarding
// ============================================================

assert.match(
  app,
  /function reviewResolutionLeaseVersion\(/,
  "R2D2C2-22 UI resolves card-local lease version",
);

assert.match(
  app,
  /function withReviewResolutionLease\(/,
  "R2D2C2-23 shared mutation body helper exists",
);

assert.match(
  app,
  /lease_version:[\s\S]*?leaseVersion/,
  "R2D2C2-24 Staff mutation forwards lease version",
);

assert.match(
  app,
  /withReviewResolutionLease\([\s\S]*?action:[\s\S]*?"CORRECT"/,
  "R2D2C2-25 CORRECT sends Staff lease precondition",
);

assert.match(
  app,
  /withReviewResolutionLease\([\s\S]*?action:[\s\S]*?"IGNORE"/,
  "R2D2C2-26 IGNORE sends Staff lease precondition",
);


// ============================================================
// Conflict refresh
// ============================================================

assert.match(
  app,
  /REVIEW_RESOLUTION_CLAIM_CONFLICTS/,
  "R2D2C2-27 UI has resolution conflict contract",
);

assert.match(
  app,
  /STALE_CLAIM_VERSION/,
  "R2D2C2-28 stale same-Staff tab is recognized in UI",
);

assert.match(
  app,
  /CLAIM_EXPIRED/,
  "R2D2C2-29 expired claim is recognized in UI",
);

assert.match(
  app,
  /refreshReviewAfterResolutionConflict/,
  "R2D2C2-30 one-card conflict refresh helper exists",
);

assert.match(
  app,
  /refreshReviewClaimState\([\s\S]*?card/,
  "R2D2C2-31 conflict refresh re-reads affected card claim state",
);

assert.match(
  app,
  /isReviewResolutionClaimConflict\([\s\S]*?error/,
  "R2D2C2-32 mutation errors use claim conflict classification",
);


// Browser request still cannot select trusted actor/session.
const resolutionSectionStart =
  app.indexOf(
    "function withReviewResolutionLease(",
  );

const resolutionSectionEnd =
  app.indexOf(
    "async function loadReviews()",
    resolutionSectionStart,
  );

assert.notEqual(
  resolutionSectionStart,
  -1,
  "R2D2C2-33 resolution UI section exists",
);

assert.notEqual(
  resolutionSectionEnd,
  -1,
  "R2D2C2-34 resolution UI section boundary exists",
);

const resolutionSection =
  app.slice(
    resolutionSectionStart,
    resolutionSectionEnd,
  );

assert.doesNotMatch(
  resolutionSection,
  /\bstaff_id\s*:/,
  "R2D2C2-35 browser resolution body cannot choose Staff owner",
);

assert.doesNotMatch(
  resolutionSection,
  /\bsettlement_session_id\s*:/,
  "R2D2C2-36 browser resolution body cannot choose Settlement",
);


console.log(
  "PASS: R2D2C-2 Staff Review Resolution API + UI Integration",
);
