import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";

import {
  normalizePostCloseArchiveId,
  normalizePostCloseClaimAction,
  normalizePostCloseClaimLeaseSeconds,
  normalizePostCloseLeaseVersion,
} from "./src/lib/staff-post-close-review-claim.mjs";


const migration =
  await readFile(
    "supabase/migrations/20260903133000_add_post_close_review_claim_lease.sql",
    "utf8",
  );

const helper =
  await readFile(
    "src/lib/staff-post-close-review-claim.mjs",
    "utf8",
  );

const api =
  await readFile(
    "netlify/functions/staff-post-close-review-claim.mjs",
    "utf8",
  );


console.log(
  "===== Staff Post-close Review Claim / Lease v9.23 =====",
);


// ------------------------------------------------------------
// R2D3C1-01 — dedicated post-close claim table
// ------------------------------------------------------------

assert.match(
  migration,
  /create table if not exists[\s\S]*public\.staff_post_close_review_claims/i,
);

assert.match(
  migration,
  /archive_id uuid primary key/i,
);

assert.match(
  migration,
  /references public\.post_close_review_archive\(id\)/i,
);

assert.match(
  migration,
  /references public\.staff_accounts\(id\)/i,
);

console.log(
  "PASS R2D3C1-01: durable archive identity owns separate Staff claim",
);


// ------------------------------------------------------------
// R2D3C1-02 — soft lease + version
// ------------------------------------------------------------

assert.match(
  migration,
  /claim_expires_at timestamptz not null/i,
);

assert.match(
  migration,
  /lease_version bigint not null/i,
);

assert.match(
  migration,
  /check\s*\(\s*lease_version > 0\s*\)/i,
);

console.log(
  "PASS R2D3C1-02: post-close claim uses soft lease and version",
);


// ------------------------------------------------------------
// R2D3C1-03 — independent concurrency namespace
// ------------------------------------------------------------

assert.match(
  migration,
  /pg_advisory_xact_lock/i,
);

assert.match(
  migration,
  /staff-post-close-review-claim:/,
);

assert.doesNotMatch(
  migration,
  /staff-work-claim:/,
);

console.log(
  "PASS R2D3C1-03: post-close ownership has independent advisory lock",
);


// ------------------------------------------------------------
// R2D3C1-04 — authorization + identity one lookup
// ------------------------------------------------------------

const scopedLookups =
  migration.match(
    /a\.id = p_archive_id[\s\S]*?a\.line_group_id =[\s\S]*?any\s*\(/g,
  ) ?? [];

assert.equal(
  scopedLookups.length,
  2,
);

assert.doesNotMatch(
  migration,
  /POST_CLOSE_REVIEW_OUTSIDE_STAFF_SCOPE/,
);

assert.match(
  migration,
  /POST_CLOSE_REVIEW_NOT_FOUND/,
);

console.log(
  "PASS R2D3C1-04: missing and out-of-scope archive are indistinguishable",
);


// ------------------------------------------------------------
// R2D3C1-05 — active Staff required in Claim + Release
// ------------------------------------------------------------

const staffActiveChecks =
  migration.match(
    /and s\.enabled = true;/g,
  ) ?? [];

assert.ok(
  staffActiveChecks.length >= 2,
);

assert.match(
  migration,
  /STAFF_NOT_ACTIVE/,
);

console.log(
  "PASS R2D3C1-05: Claim and Release require active Staff",
);


// ------------------------------------------------------------
// R2D3C1-06 — standard claim semantics
// ------------------------------------------------------------

assert.match(
  migration,
  /'CLAIMED'/,
);

assert.match(
  migration,
  /'RENEWED'/,
);

assert.match(
  migration,
  /'BUSY'/,
);

assert.match(
  migration,
  /v_claim\.claim_expires_at[\s\S]*?<= v_now/i,
);

assert.match(
  migration,
  /lease_version =[\s\S]*?lease_version \+ 1/i,
);

console.log(
  "PASS R2D3C1-06: claim renew busy and expired-reclaim semantics exist",
);


// ------------------------------------------------------------
// R2D3C1-07 — stale release protection
// ------------------------------------------------------------

assert.match(
  migration,
  /CLAIM_OWNED_BY_OTHER/,
);

assert.match(
  migration,
  /STALE_CLAIM_VERSION/,
);

assert.match(
  migration,
  /p_expected_lease_version/i,
);

assert.match(
  migration,
  /'RELEASED'/,
);

console.log(
  "PASS R2D3C1-07: release protects ownership and lease version",
);


// ------------------------------------------------------------
// R2D3C1-08 — bounded active claim-state read
// ------------------------------------------------------------

assert.match(
  migration,
  /staff_post_close_review_claim_state/,
);

assert.match(
  migration,
  /p_archive_ids uuid\[\]/i,
);

assert.match(
  migration,
  /claim_expires_at >[\s\S]*?clock_timestamp\(\)/i,
);

console.log(
  "PASS R2D3C1-08: bounded active post-close claim state exists",
);


// ------------------------------------------------------------
// R2D3C1-09 — DB boundary service-role only
// ------------------------------------------------------------

assert.match(
  migration,
  /revoke all[\s\S]*?from public, anon, authenticated/i,
);

assert.match(
  migration,
  /grant execute[\s\S]*?to service_role/i,
);

assert.match(
  migration,
  /enable row level security/i,
);

console.log(
  "PASS R2D3C1-09: claim table and RPCs remain server-side",
);


// ------------------------------------------------------------
// R2D3C1-10 — no live lifecycle dependency
// ------------------------------------------------------------

for (
  const forbidden of [
    "staff_message_work_claims",
    "claim_staff_review_work",
    "release_staff_review_work",
    "staff_workbench_claim_state",
    "public.messages",
    "public.review_items",
    "settlement_line_group_config",
    "settlement_summary_group_rounds",
  ]
) {
  assert.ok(
    !migration.includes(
      forbidden,
    ),
    `migration must not depend on ${forbidden}`,
  );
}

console.log(
  "PASS R2D3C1-10: post-close claim is independent of live Review lifecycle",
);


// ------------------------------------------------------------
// R2D3C1-11 — helper normalization
// ------------------------------------------------------------

assert.equal(
  normalizePostCloseClaimAction(
    "claim",
  ),
  "CLAIM",
);

assert.equal(
  normalizePostCloseClaimAction(
    "release",
  ),
  "RELEASE",
);

assert.equal(
  normalizePostCloseClaimAction(
    "steal",
  ),
  null,
);

assert.equal(
  normalizePostCloseClaimLeaseSeconds(
    null,
  ),
  300,
);

assert.equal(
  normalizePostCloseClaimLeaseSeconds(
    5,
  ),
  60,
);

assert.equal(
  normalizePostCloseClaimLeaseSeconds(
    9999,
  ),
  1800,
);

assert.equal(
  normalizePostCloseLeaseVersion(
    "3",
  ),
  3,
);

assert.equal(
  normalizePostCloseLeaseVersion(
    0,
  ),
  null,
);

const validArchiveId =
  "67e46e65-ebcc-49d3-b749-5c1e6b19d13a";

assert.equal(
  normalizePostCloseArchiveId(
    ` ${validArchiveId} `,
  ),
  validArchiveId,
);

assert.equal(
  normalizePostCloseArchiveId(
    "not-a-uuid",
  ),
  null,
);

console.log(
  "PASS R2D3C1-11: helper inputs fail closed and lease bounds match live semantics",
);


// ------------------------------------------------------------
// R2D3C1-12 — helper calls dedicated atomic RPCs
// ------------------------------------------------------------

assert.match(
  helper,
  /claim_staff_post_close_review_work/,
);

assert.match(
  helper,
  /release_staff_post_close_review_work/,
);

assert.match(
  helper,
  /p_archive_id/,
);

assert.match(
  helper,
  /p_staff_id/,
);

assert.match(
  helper,
  /p_allowed_line_group_ids/,
);

assert.match(
  helper,
  /p_expected_lease_version/,
);

console.log(
  "PASS R2D3C1-12: helper wires dedicated post-close RPC contracts",
);


// ------------------------------------------------------------
// R2D3C1-13 — Staff-only API
// ------------------------------------------------------------

assert.match(
  api,
  /authenticateWorkbenchActor/,
);

assert.match(
  api,
  /!auth\.actor\.staff_id/,
);

assert.match(
  api,
  /STAFF_IDENTITY_REQUIRED/,
);

assert.match(
  api,
  /\/api\/staff-post-close-review-claim/,
);

console.log(
  "PASS R2D3C1-13: post-close claim endpoint requires real Staff identity",
);


// ------------------------------------------------------------
// R2D3C1-14 — current assignments authorize historical work
// ------------------------------------------------------------

assert.match(
  api,
  /loadWorkbenchActorLineGroups/,
);

assert.match(
  api,
  /allowedLineGroupIds/,
);

assert.doesNotMatch(
  api,
  /loadActorSessionLineGroupIds/,
);

assert.doesNotMatch(
  api,
  /fetchOpenSettlementSession/,
);

console.log(
  "PASS R2D3C1-14: current Staff assignments authorize post-close ownership",
);


// ------------------------------------------------------------
// R2D3C1-15 — browser cannot choose trusted scope
// ------------------------------------------------------------

for (
  const forbidden of [
    "body?.staff_id",
    "body?.line_group_id",
    "body?.summary_group_id",
    "body?.round_id",
    "body?.settlement_session_id",
  ]
) {
  assert.ok(
    !api.includes(
      forbidden,
    ),
    `browser must not choose trusted scope: ${forbidden}`,
  );
}

assert.match(
  api,
  /body\?\.archive_id/,
);

console.log(
  "PASS R2D3C1-15: browser supplies archive identity but not trusted ownership scope",
);


// ------------------------------------------------------------
// R2D3C1-16 — malformed UUID rejected before RPC
// ------------------------------------------------------------

assert.match(
  api,
  /normalizePostCloseArchiveId/,
);

assert.match(
  api,
  /INVALID_ARCHIVE_ID/,
);

assert.match(
  api,
  /400/,
);

console.log(
  "PASS R2D3C1-16: malformed archive identity fails before Postgres UUID cast",
);


// ------------------------------------------------------------
// R2D3C1-17 — missing / unauthorized archive = same 404
// ------------------------------------------------------------

assert.match(
  api,
  /POST_CLOSE_REVIEW_NOT_FOUND/,
);

assert.match(
  api,
  /404/,
);

assert.doesNotMatch(
  api,
  /POST_CLOSE_REVIEW_OUTSIDE_STAFF_SCOPE/,
);

console.log(
  "PASS R2D3C1-17: post-close archive anti-enumeration reaches HTTP boundary",
);


// ------------------------------------------------------------
// R2D3C1-18 — claim conflicts use HTTP 409
// ------------------------------------------------------------

for (
  const status of [
    "BUSY",
    "CLAIM_OWNED_BY_OTHER",
    "STALE_CLAIM_VERSION",
  ]
) {
  assert.ok(
    api.includes(
      status,
    ),
    `missing claim conflict status ${status}`,
  );
}

assert.match(
  api,
  /409/,
);

console.log(
  "PASS R2D3C1-18: concurrent ownership conflicts use explicit 409",
);


// ------------------------------------------------------------
// R2D3C1-19 — C1 cannot mutate archive/canonical data
// ------------------------------------------------------------

for (
  const source of [
    helper,
    api,
  ]
) {
  for (
    const forbidden of [
      ".from(\"post_close_review_archive\")",
      ".from(\"order_items\")",
      "/api/review-resolve",
      "CORRECT",
      "IGNORE",
    ]
  ) {
    assert.ok(
      !source.includes(
        forbidden,
      ),
      `C1 application layer must not mutate/use ${forbidden}`,
    );
  }
}

console.log(
  "PASS R2D3C1-19: application layer mutates claim state only through RPC",
);


// ------------------------------------------------------------
// R2D3C1-20 — browser RELEASE requires exact lease version
// ------------------------------------------------------------

assert.match(
  api,
  /action === "RELEASE"[\s\S]*?normalizePostCloseLeaseVersion\([\s\S]*?body\?\.lease_version/,
);

assert.match(
  api,
  /action === "RELEASE"[\s\S]*?!expectedLeaseVersion/,
);

assert.match(
  api,
  /INVALID_LEASE_VERSION/,
);

assert.match(
  api,
  /expectedLeaseVersion,/,
);

console.log(
  "PASS R2D3C1-20: browser RELEASE requires an exact observed lease version",
);


console.log(
  "PASS: Staff Post-close Review Claim / Lease v9.23",
);
