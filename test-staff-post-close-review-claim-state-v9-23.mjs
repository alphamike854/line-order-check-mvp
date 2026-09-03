import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";

import {
  buildStaffPostCloseReviewItem,
  loadStaffPostCloseReviewClaimState,
  resolveStaffPostCloseReviewClaimState,
} from "./src/lib/staff-post-close-review.mjs";


const api =
  await readFile(
    "netlify/functions/staff-post-close-reviews.mjs",
    "utf8",
  );

const helper =
  await readFile(
    "src/lib/staff-post-close-review.mjs",
    "utf8",
  );

const migration =
  await readFile(
    "supabase/migrations/"
      + "20260903133000_add_post_close_review_claim_lease.sql",
    "utf8",
  );

const app =
  await readFile(
    "public/app.js",
    "utf8",
  );


console.log(
  "===== Staff Post-close Review Claim State v9.23 =====",
);


// ------------------------------------------------------------
// 01 — No claim = AVAILABLE
// ------------------------------------------------------------

assert.equal(
  resolveStaffPostCloseReviewClaimState({
    claim: null,
    actorStaffId: "staff-a",
  }),
  "AVAILABLE",
);

console.log(
  "PASS R2D3C2A-01: unclaimed archive is AVAILABLE",
);


// ------------------------------------------------------------
// 02 — Own claim = MINE
// ------------------------------------------------------------

assert.equal(
  resolveStaffPostCloseReviewClaimState({
    claim: {
      staff_id: "staff-a",
    },
    actorStaffId: "staff-a",
  }),
  "MINE",
);

console.log(
  "PASS R2D3C2A-02: own active claim is MINE",
);


// ------------------------------------------------------------
// 03 — Other Staff = OTHER
// ------------------------------------------------------------

assert.equal(
  resolveStaffPostCloseReviewClaimState({
    claim: {
      staff_id: "staff-b",
    },
    actorStaffId: "staff-a",
  }),
  "OTHER",
);

console.log(
  "PASS R2D3C2A-03: another Staff active claim is OTHER",
);


// ------------------------------------------------------------
// 04 — malformed claim fails closed
// ------------------------------------------------------------

assert.equal(
  resolveStaffPostCloseReviewClaimState({
    claim: {},
    actorStaffId: "staff-a",
  }),
  "OTHER",
);

console.log(
  "PASS R2D3C2A-04: malformed claim fails closed",
);


// ------------------------------------------------------------
// 05 — empty page skips RPC
// ------------------------------------------------------------

let emptyRpcCalls = 0;

const emptyClient = {
  rpc: async () => {
    emptyRpcCalls += 1;

    return {
      data: [],
      error: null,
    };
  },
};

assert.deepEqual(
  await loadStaffPostCloseReviewClaimState(
    emptyClient,
    [],
  ),
  [],
);

assert.equal(
  emptyRpcCalls,
  0,
);

console.log(
  "PASS R2D3C2A-05: empty archive page skips RPC",
);


// ------------------------------------------------------------
// 06 — exact bounded/de-duplicated IDs
// ------------------------------------------------------------

const archiveA =
  "11111111-1111-4111-8111-111111111111";

const archiveB =
  "22222222-2222-4222-8222-222222222222";

let rpcName = null;
let rpcArgs = null;

const rpcClient = {
  rpc: async (
    name,
    args,
  ) => {
    rpcName = name;
    rpcArgs = args;

    return {
      data: [
        {
          archive_id: archiveA,
          staff_id: "staff-a",
          staff_code: "STAFF-A",
          staff_display_name: "Staff A",
          claim_expires_at:
            "2099-09-03T10:05:00.000Z",
          lease_version: 4,
        },
      ],
      error: null,
    };
  },
};

const claimRows =
  await loadStaffPostCloseReviewClaimState(
    rpcClient,
    [
      archiveA,
      archiveA,
      ` ${archiveB} `,
    ],
  );

assert.equal(
  rpcName,
  "staff_post_close_review_claim_state",
);

assert.deepEqual(
  rpcArgs,
  {
    p_archive_ids: [
      archiveA,
      archiveB,
    ],
  },
);

assert.equal(
  claimRows.length,
  1,
);

console.log(
  "PASS R2D3C2A-06: claim-state read is page-bounded and deduplicated",
);


// ------------------------------------------------------------
// 07 — DB/RPC error fails closed
// ------------------------------------------------------------

await assert.rejects(
  () =>
    loadStaffPostCloseReviewClaimState(
      {
        rpc: async () => ({
          data: null,
          error: {
            message:
              "CLAIM_STATE_READ_FAILED",
          },
        }),
      },
      [archiveA],
    ),
  /CLAIM_STATE_READ_FAILED/,
);

console.log(
  "PASS R2D3C2A-07: claim-state read errors fail request closed",
);


// ------------------------------------------------------------
// Item fixture
// ------------------------------------------------------------

const row = {
  id: archiveA,
  source_review_id: 123,
  source_message_record_id:
    "33333333-3333-4333-8333-333333333333",
  line_group_id: "LINE-A",
  summary_group_id: "NORTH",
  round_no: 2,
  business_date: "2099-09-03",
  message_type: "text",
  raw_text: "01=20",
  parse_status: "REVIEW",
  reason_codes: [],
  warnings: [],
};


// ------------------------------------------------------------
// 08 — AVAILABLE clears claim metadata
// ------------------------------------------------------------

const available =
  buildStaffPostCloseReviewItem(
    row,
    {
      lineGroupName: "Line A",
      actorStaffId: "staff-a",
      claim: null,
    },
  );

assert.equal(
  available.claim_state,
  "AVAILABLE",
);

assert.equal(
  available.claimed_by_staff_code,
  null,
);

assert.equal(
  available.claimed_by_display_name,
  null,
);

assert.equal(
  available.claim_expires_at,
  null,
);

assert.equal(
  available.lease_version,
  null,
);

console.log(
  "PASS R2D3C2A-08: AVAILABLE exposes no stale claim metadata",
);


// ------------------------------------------------------------
// 09 — MINE carries lease
// ------------------------------------------------------------

const mine =
  buildStaffPostCloseReviewItem(
    row,
    {
      actorStaffId: "staff-a",

      claim: {
        archive_id: archiveA,
        staff_id: "staff-a",
        staff_code: "STAFF-A",
        staff_display_name: "Staff A",
        claim_expires_at:
          "2099-09-03T10:05:00.000Z",
        lease_version: "7",
      },
    },
  );

assert.equal(
  mine.claim_state,
  "MINE",
);

assert.equal(
  mine.claimed_by_staff_code,
  "STAFF-A",
);

assert.equal(
  mine.claimed_by_display_name,
  "Staff A",
);

assert.equal(
  mine.lease_version,
  7,
);

console.log(
  "PASS R2D3C2A-09: MINE carries current holder and lease version",
);


// ------------------------------------------------------------
// 10 — OTHER exposes safe holder data, not UUID
// ------------------------------------------------------------

const other =
  buildStaffPostCloseReviewItem(
    row,
    {
      actorStaffId: "staff-a",

      claim: {
        archive_id: archiveA,
        staff_id: "staff-b",
        staff_code: "STAFF-B",
        staff_display_name: "Staff B",
        claim_expires_at:
          "2099-09-03T10:05:00.000Z",
        lease_version: 9,
      },
    },
  );

assert.equal(
  other.claim_state,
  "OTHER",
);

assert.equal(
  other.claimed_by_staff_code,
  "STAFF-B",
);

assert.equal(
  other.claimed_by_display_name,
  "Staff B",
);

assert.equal(
  other.lease_version,
  9,
);

assert.equal(
  "claimed_by_staff_id" in other,
  false,
);

console.log(
  "PASS R2D3C2A-10: OTHER hides holder Staff UUID",
);


// ------------------------------------------------------------
// 11 — API batch comes from returned page IDs
// ------------------------------------------------------------

assert.match(
  api,
  /const archiveIds\s*=[\s\S]*?rows[\s\S]*?row\?\.id/,
);

assert.match(
  api,
  /loadStaffPostCloseReviewClaimState\([\s\S]*?supabase,[\s\S]*?archiveIds/,
);

assert.match(
  api,
  /claimByArchiveId[\s\S]*?claim\?\.archive_id/,
);

console.log(
  "PASS R2D3C2A-11: API reads claim state only for returned archive page",
);


// ------------------------------------------------------------
// 12 — actor determines MINE
// ------------------------------------------------------------

assert.match(
  api,
  /actorStaffId:[\s\S]*?auth\.actor\.staff_id/,
);

assert.match(
  api,
  /claim:[\s\S]*?claimByArchiveId\.get\([\s\S]*?row\?\.id/,
);

console.log(
  "PASS R2D3C2A-12: authenticated Staff determines ownership state",
);


// ------------------------------------------------------------
// 13 — current assignment boundary retained
// ------------------------------------------------------------

assert.match(
  api,
  /loadWorkbenchActorLineGroups/,
);

assert.match(
  api,
  /lineGroupIds[\s\S]*?loadStaffPostCloseReviewReadModel/,
);

console.log(
  "PASS R2D3C2A-13: current Staff assignments remain authoritative",
);


// ------------------------------------------------------------
// 14 — no live lifecycle dependencies
// ------------------------------------------------------------

for (
  const forbidden
  of [
    "fetchOpenSettlementSession",
    "loadActorSessionLineGroupIds",
    "staff_message_work_claims",
    "claim_staff_review_work",
    "release_staff_review_work",
    "staff_workbench_claim_state",
  ]
) {
  assert.equal(
    api.includes(forbidden),
    false,
    `API must not depend on ${forbidden}`,
  );

  assert.equal(
    helper.includes(forbidden),
    false,
    `helper must not depend on ${forbidden}`,
  );
}

console.log(
  "PASS R2D3C2A-14: post-close state remains lifecycle-independent",
);


// ------------------------------------------------------------
// 15 — read-only application layer
// ------------------------------------------------------------

for (
  const forbidden
  of [
    ".insert(",
    ".update(",
    ".delete(",
    ".upsert(",
  ]
) {
  assert.equal(
    api.includes(forbidden),
    false,
  );

  assert.equal(
    helper.includes(forbidden),
    false,
  );
}

assert.equal(
  api.includes(
    "claimStaffPostCloseReviewWork",
  ),
  false,
);

assert.equal(
  api.includes(
    "releaseStaffPostCloseReviewWork",
  ),
  false,
);

console.log(
  "PASS R2D3C2A-15: C2A introduces no application mutation",
);


// ------------------------------------------------------------
// 16 — expired/disabled claims absent at DB boundary
// ------------------------------------------------------------

assert.match(
  migration,
  /staff_post_close_review_claim_state[\s\S]*?claim_expires_at\s*>[\s\S]*?clock_timestamp\(\)/,
);

assert.match(
  migration,
  /staff_post_close_review_claim_state[\s\S]*?s\.enabled\s*=\s*true/,
);

console.log(
  "PASS R2D3C2A-16: DB returns active enabled-Staff claims only",
);


// ------------------------------------------------------------
// 17 — pagination remains intact
// ------------------------------------------------------------

assert.match(
  api,
  /pagination:[\s\S]*?limit:[\s\S]*?offset:[\s\S]*?returned:[\s\S]*?total(?:\s*:|\s*,)[\s\S]*?has_more:/,
);

console.log(
  "PASS R2D3C2A-17: bounded pagination contract remains intact",
);


// ------------------------------------------------------------
// 18 — browser mutation remains outside C2A
// ------------------------------------------------------------

assert.equal(
  app.includes(
    "/api/staff-post-close-review-claim",
  ),
  false,
);

console.log(
  "PASS R2D3C2A-18: browser Claim/Renew/Release remains outside C2A",
);


console.log(
  "PASS: Staff Post-close Review Claim State v9.23",
);
