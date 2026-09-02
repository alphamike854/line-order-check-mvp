import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";

import {
  buildStaffWorkbenchPayload,
  resolveWorkbenchClaimState,
} from "./src/lib/staff-workbench.mjs";

const helper =
  await readFile(
    "src/lib/staff-workbench.mjs",
    "utf8",
  );

assert.match(
  helper,
  /staff_workbench_claim_state/,
  "R2D2B-01 Workbench reads bounded active claim state",
);

assert.match(
  helper,
  /p_message_record_ids/,
  "R2D2B-02 claim query uses only current Workbench message IDs",
);

assert.match(
  helper,
  /\.from\(\s*"staff_accounts"/,
  "R2D2B-03 holder identity is resolved server-side",
);

assert.equal(
  resolveWorkbenchClaimState(),
  "AVAILABLE",
  "R2D2B-04 no claim is available",
);

assert.equal(
  resolveWorkbenchClaimState({
    actorStaffId: "staff-1",
    claimStaffId: "staff-1",
    claimExpiresAt:
      "2099-09-02T12:05:00.000Z",
    now:
      Date.parse(
        "2099-09-02T12:00:00.000Z",
      ),
  }),
  "MINE",
  "R2D2B-05 own active lease is MINE",
);

assert.equal(
  resolveWorkbenchClaimState({
    actorStaffId: "staff-1",
    claimStaffId: "staff-2",
    claimExpiresAt:
      "2099-09-02T12:05:00.000Z",
    now:
      Date.parse(
        "2099-09-02T12:00:00.000Z",
      ),
  }),
  "CLAIMED_BY_OTHER",
  "R2D2B-06 another Staff active lease is protected",
);

assert.equal(
  resolveWorkbenchClaimState({
    actorStaffId: "staff-1",
    claimStaffId: "staff-2",
    claimExpiresAt:
      "2099-09-02T11:59:00.000Z",
    now:
      Date.parse(
        "2099-09-02T12:00:00.000Z",
      ),
  }),
  "EXPIRED",
  "R2D2B-07 stale expired snapshot is defensive EXPIRED state",
);

const workItem = {
  review_id: 101,
  message_record_id:
    "11111111-1111-4111-8111-111111111111",
  summary_group_id: "NORTH",
  summary_group_name: "NORTH",
  line_group_id: "LINE-A",
  line_group_name: "LINE Group A",
  summary_group_round_id:
    "22222222-2222-4222-8222-222222222222",
  round_no: 1,
  round_status: "OPEN",
  event_timestamp:
    "2099-09-02T12:00:00.000Z",
  message_created_at:
    "2099-09-02T12:00:00.000Z",
  review_created_at:
    "2099-09-02T12:00:01.000Z",
  user_id: "LINE-USER",
  message_type: "text",
  display_text:
    "01 02 03 = 20",
  parse_status: "REVIEW",
  parser_version: "1.7.13",
  reason_codes: [],
  warnings: [],
  has_image_evidence: false,
  message_order_total: 60,
  items: [],
};

const minePayload =
  buildStaffWorkbenchPayload({
    actor: {
      staff_id: "staff-1",
      staff_code: "STAFF01",
      display_name: "Staff 01",
      role: "STAFF",
      is_admin: false,
    },
    session: {
      id:
        "33333333-3333-4333-8333-333333333333",
      business_date:
        "2099-09-02",
    },
    summaryRows: [],
    workItems: [
      {
        ...workItem,
        claim_staff_id:
          "staff-1",
        claim_staff_code:
          "STAFF01",
        claim_display_name:
          "Staff 01",
        claimed_at:
          "2099-09-02T12:00:00.000Z",
        claim_expires_at:
          "2099-09-02T12:05:00.000Z",
        lease_version: 4,
      },
    ],
  });

assert.equal(
  minePayload.work_items[0]
    .claim_state,
  "MINE",
  "R2D2B-08 payload marks own active claim",
);

assert.equal(
  minePayload.work_items[0]
    .claimed_by_display_name,
  "Staff 01",
  "R2D2B-09 payload includes safe holder display name",
);

assert.equal(
  minePayload.work_items[0]
    .lease_version,
  4,
  "R2D2B-10 payload includes lease version",
);

const otherPayload =
  buildStaffWorkbenchPayload({
    actor: {
      staff_id: "staff-1",
      staff_code: "STAFF01",
      display_name: "Staff 01",
      role: "STAFF",
      is_admin: false,
    },
    session: {
      id:
        "33333333-3333-4333-8333-333333333333",
    },
    summaryRows: [],
    workItems: [
      {
        ...workItem,
        claim_staff_id:
          "staff-2",
        claim_staff_code:
          "STAFF02",
        claim_display_name:
          "Staff 02",
        claimed_at:
          "2099-09-02T12:00:00.000Z",
        claim_expires_at:
          "2099-09-02T12:05:00.000Z",
        lease_version: 8,
      },
    ],
  });

assert.equal(
  otherPayload.work_items[0]
    .claim_state,
  "CLAIMED_BY_OTHER",
  "R2D2B-11 payload protects another Staff claim",
);

assert.equal(
  otherPayload.work_items[0]
    .claimed_by_staff_id,
  "staff-2",
  "R2D2B-12 exact holder identity is preserved",
);

const availablePayload =
  buildStaffWorkbenchPayload({
    actor: {
      staff_id: "staff-1",
      staff_code: "STAFF01",
      display_name: "Staff 01",
      role: "STAFF",
      is_admin: false,
    },
    session: {
      id:
        "33333333-3333-4333-8333-333333333333",
    },
    summaryRows: [],
    workItems: [
      workItem,
    ],
  });

assert.equal(
  availablePayload.work_items[0]
    .claim_state,
  "AVAILABLE",
  "R2D2B-13 unclaimed Workbench item is AVAILABLE",
);

assert.equal(
  availablePayload.work_items[0]
    .lease_version,
  null,
  "R2D2B-14 unclaimed item carries no lease version",
);

console.log(
  "PASS: R2D2B Staff Workbench Claim State Integration",
);
