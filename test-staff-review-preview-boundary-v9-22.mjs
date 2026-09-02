import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";


const preview =
  await readFile(
    "netlify/functions/review-preview.mjs",
    "utf8",
  );

const access =
  await readFile(
    "src/lib/staff-review-access.mjs",
    "utf8",
  );


assert.match(
  preview,
  /x-staff-key/,
  "R2D2B3B-01 Preview detects explicit Staff credential mode",
);

assert.match(
  preview,
  /authenticateWorkbenchActor/,
  "R2D2B3B-02 Staff Preview authenticates Staff server-side",
);

assert.match(
  preview,
  /requireDashboardAccess/,
  "R2D2B3B-03 legacy Dashboard Preview auth remains present",
);

assert.match(
  preview,
  /if\s*\(\s*suppliedStaffKey\s*\)[\s\S]*?else\s*\{[\s\S]*?requireDashboardAccess/,
  "R2D2B3B-04 Dashboard and Staff auth paths remain explicit",
);

assert.match(
  preview,
  /fetchOpenSettlementSession/,
  "R2D2B3B-05 Staff Preview resolves current settlement server-side",
);

assert.match(
  preview,
  /loadActorSessionLineGroupIds/,
  "R2D2B3B-06 Staff assignment scope is resolved server-side",
);

assert.match(
  preview,
  /loadStaffReviewPreviewAccess/,
  "R2D2B3B-07 Staff Preview uses targeted review access boundary",
);

assert.doesNotMatch(
  preview,
  /body\?*\.staff_id|body\.staff_id/,
  "R2D2B3B-08 browser cannot choose Staff identity",
);

assert.doesNotMatch(
  preview,
  /body\?*\.settlement_session_id|body\.settlement_session_id/,
  "R2D2B3B-09 browser cannot choose Settlement identity",
);

assert.match(
  access,
  /\.from\(\s*"review_items"\s*\)[\s\S]*?\.eq\(\s*"id"[\s\S]*?safeReviewId/,
  "R2D2B3B-10 access lookup is targeted by Review ID",
);

assert.match(
  access,
  /settlement_session_id[\s\S]*?MESSAGE_OUTSIDE_CURRENT_SETTLEMENT/,
  "R2D2B3B-11 historical Settlement messages are rejected",
);

assert.match(
  access,
  /safeLineGroupIds\.includes[\s\S]*?MESSAGE_OUTSIDE_STAFF_SCOPE/,
  "R2D2B3B-12 unassigned LINE Groups are rejected",
);

assert.match(
  access,
  /settlement_line_group_config/,
  "R2D2B3B-13 Settlement snapshot config is authoritative",
);

assert.match(
  access,
  /settlement_summary_group_rounds/,
  "R2D2B3B-14 latest Summary Group Round is checked",
);

assert.match(
  access,
  /\.order\(\s*"round_no"[\s\S]*?ascending:\s*false/,
  "R2D2B3B-15 latest Round uses highest round number",
);

assert.match(
  access,
  /summary_group_round_id[\s\S]*?MESSAGE_ROUND_NOT_CURRENT/,
  "R2D2B3B-16 stale Round ownership is rejected",
);

assert.match(
  access,
  /staff_workbench_claim_state/,
  "R2D2B3B-17 active claim state uses existing bounded RPC",
);

assert.match(
  access,
  /p_message_record_ids:[\s\S]*?message\.id/,
  "R2D2B3B-18 claim read is bounded to the target message",
);

assert.match(
  access,
  /if\s*\(\s*!claim\s*\)[\s\S]*?CLAIM_REQUIRED/,
  "R2D2B3B-19 unclaimed or expired work cannot Preview",
);

assert.match(
  access,
  /claim\.staff_id[\s\S]*?safeStaffId[\s\S]*?CLAIM_OWNED_BY_OTHER/,
  "R2D2B3B-20 another Staff active claim cannot Preview",
);

assert.doesNotMatch(
  access,
  /staff_workbench_open_reviews/,
  "R2D2B3B-21 targeted Preview must not depend on paginated Workbench list",
);

assert.match(
  preview,
  /reviewPreviewFingerprint/,
  "R2D2B3B-22 existing Preview fingerprint safety remains",
);

assert.match(
  preview,
  /createReviewPreviewToken/,
  "R2D2B3B-23 existing signed Preview token remains",
);


console.log(
  "PASS: R2D2B-3B Staff Review Preview Boundary",
);
