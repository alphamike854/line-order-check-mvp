import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";

import {
  normalizeClaimAction,
  normalizeClaimLeaseSeconds,
  normalizeLeaseVersion,
  normalizeMessageRecordId,
} from "./src/lib/staff-work-claim.mjs";


const migration =
  await readFile(
    "supabase/migrations/20260902080000_add_message_work_claim_lease.sql",
    "utf8",
  );

const helper =
  await readFile(
    "src/lib/staff-work-claim.mjs",
    "utf8",
  );

const api =
  await readFile(
    "netlify/functions/staff-work-claim.mjs",
    "utf8",
  );


assert.match(
  migration,
  /create table if not exists public\.staff_message_work_claims/i,
  "R2D2A-01 message-level claim table exists",
);

assert.match(
  migration,
  /message_record_id uuid primary key/i,
  "R2D2A-02 exactly one current claim exists per message",
);

assert.match(
  migration,
  /references public\.messages\(id\)/i,
  "R2D2A-03 claim is owned by canonical message identity",
);

assert.match(
  migration,
  /references public\.staff_accounts\(id\)/i,
  "R2D2A-04 claim owner is trusted Staff identity",
);

assert.match(
  migration,
  /claim_expires_at timestamptz not null/i,
  "R2D2A-05 claim uses soft lease expiry",
);

assert.match(
  migration,
  /lease_version bigint not null/i,
  "R2D2A-06 claim carries lease version",
);

assert.match(
  migration,
  /pg_advisory_xact_lock/i,
  "R2D2A-07 concurrent claim transitions are serialized",
);

assert.match(
  migration,
  /MESSAGE_OUTSIDE_STAFF_SCOPE/i,
  "R2D2A-08 DB rejects claims outside assigned LINE Group scope",
);

assert.match(
  migration,
  /review\.status|r\.status = 'OPEN'/i,
  "R2D2A-09 only currently actionable OPEN Review is claimable",
);

assert.match(
  migration,
  /v_claim\.claim_expires_at[\s\S]*<= v_now/i,
  "R2D2A-10 expired claim is reclaimable",
);

assert.match(
  migration,
  /v_claim\.staff_id[\s\S]*p_staff_id[\s\S]*RENEWED/i,
  "R2D2A-11 same Staff may renew own lease",
);

assert.match(
  migration,
  /STALE_CLAIM_VERSION/i,
  "R2D2A-12 stale release is protected by lease version",
);

assert.match(
  migration,
  /staff_workbench_claim_state/i,
  "R2D2A-13 bounded Workbench claim-state read model exists",
);

assert.match(
  migration,
  /claim_expires_at >[\s\S]*clock_timestamp/i,
  "R2D2A-14 expired leases are hidden from active claim state",
);

assert.match(
  migration,
  /revoke all[\s\S]*from public, anon, authenticated/i,
  "R2D2A-15 claim RPCs are not browser-callable directly",
);

assert.match(
  migration,
  /grant execute[\s\S]*to service_role/i,
  "R2D2A-16 claim RPCs remain behind service role",
);


assert.equal(
  normalizeClaimLeaseSeconds(
    null,
  ),
  300,
  "R2D2A-17 default lease is 300 seconds",
);

assert.equal(
  normalizeClaimLeaseSeconds(
    5,
  ),
  60,
  "R2D2A-18 lease has safe minimum",
);

assert.equal(
  normalizeClaimLeaseSeconds(
    9999,
  ),
  1800,
  "R2D2A-19 lease has safe maximum",
);

assert.equal(
  normalizeClaimAction(
    "claim",
  ),
  "CLAIM",
  "R2D2A-20 CLAIM action normalizes",
);

assert.equal(
  normalizeClaimAction(
    "release",
  ),
  "RELEASE",
  "R2D2A-21 RELEASE action normalizes",
);

assert.equal(
  normalizeClaimAction(
    "steal",
  ),
  null,
  "R2D2A-22 unsupported action fails closed",
);

assert.equal(
  normalizeLeaseVersion(
    "3",
  ),
  3,
  "R2D2A-23 lease version normalizes",
);

assert.equal(
  normalizeLeaseVersion(
    0,
  ),
  null,
  "R2D2A-24 invalid lease version fails safe",
);

assert.equal(
  normalizeMessageRecordId(
    " abc ",
  ),
  "abc",
  "R2D2A-25 message identity trims safely",
);


assert.match(
  api,
  /authenticateWorkbenchActor/,
  "R2D2A-26 claim API authenticates server-side actor",
);

assert.match(
  api,
  /if \(!auth\.actor\.staff_id\)/,
  "R2D2A-27 shared dashboard actor cannot impersonate Staff",
);

assert.doesNotMatch(
  api,
  /body\?\.staff_id/,
  "R2D2A-28 browser cannot choose claim owner Staff ID",
);

assert.match(
  api,
  /loadActorSessionLineGroupIds/,
  "R2D2A-29 claim API derives Staff LINE Group scope server-side",
);

assert.match(
  api,
  /claimStaffReviewWork/,
  "R2D2A-30 exact message claim endpoint is wired",
);

assert.match(
  api,
  /releaseStaffReviewWork/,
  "R2D2A-31 release endpoint is wired",
);

assert.match(
  helper,
  /claim_staff_review_work/,
  "R2D2A-32 helper calls atomic claim RPC",
);

assert.match(
  helper,
  /release_staff_review_work/,
  "R2D2A-33 helper calls atomic release RPC",
);


console.log(
  "PASS: R2D2A Message-level Shared Work Claim + Lease Foundation",
);
