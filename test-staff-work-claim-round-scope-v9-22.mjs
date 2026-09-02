import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";


const migration =
  await readFile(
    "supabase/migrations/20260902111000_harden_message_work_claim_round_scope.sql",
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
  /p_settlement_session_id uuid/i,
  "R2D2AH-01 authoritative claim/release receives trusted settlement identity",
);


assert.match(
  migration,
  /s\.id = p_settlement_session_id[\s\S]*s\.status = 'OPEN'/i,
  "R2D2AH-02 settlement container must still be OPEN",
);


assert.match(
  migration,
  /v_message\.settlement_session_id[\s\S]*is distinct from[\s\S]*p_settlement_session_id/i,
  "R2D2AH-03 historical settlement message is rejected",
);


assert.match(
  migration,
  /v_message\.summary_group_round_id[\s\S]*MESSAGE_ROUND_NOT_CURRENT/i,
  "R2D2AH-04 message must have Round ownership",
);


assert.match(
  migration,
  /order by[\s\S]*r\.round_no desc[\s\S]*limit 1/i,
  "R2D2AH-05 authoritative scope resolves latest Summary Group round",
);


assert.match(
  migration,
  /v_message\.summary_group_round_id[\s\S]*is distinct from[\s\S]*v_latest_round_id/i,
  "R2D2AH-06 previous Summary Group round is rejected",
);


assert.match(
  migration,
  /settlement_line_group_config[\s\S]*cfg\.settlement_session_id[\s\S]*cfg\.line_group_id[\s\S]*v_message\.line_group_id[\s\S]*cfg\.summary_group_id[\s\S]*v_message\.summary_group_id/i,
  "R2D2AH-07 LINE Group must match settlement Summary Group snapshot",
);


assert.doesNotMatch(
  migration,
  /v_round\.status\s*=\s*'OPEN'/i,
  "R2D2AH-08 latest CLOSED Summary Group round remains eligible",
);


assert.match(
  migration,
  /return public\.claim_staff_review_work\([\s\S]*v_session_id[\s\S]*p_lease_seconds/i,
  "R2D2AH-09 legacy claim overload delegates through hardened current settlement boundary",
);


assert.match(
  migration,
  /return public\.release_staff_review_work\([\s\S]*v_session_id[\s\S]*p_expected_lease_version/i,
  "R2D2AH-10 legacy release overload delegates through hardened current settlement boundary",
);


assert.match(
  migration,
  /revoke all[\s\S]*claim_staff_review_work\([\s\S]*uuid,[\s\S]*uuid,[\s\S]*text\[\],[\s\S]*uuid,[\s\S]*integer[\s\S]*from public, anon, authenticated/i,
  "R2D2AH-11 authoritative claim overload remains service-role only",
);


assert.match(
  helper,
  /settlementSessionId/,
  "R2D2AH-12 helper accepts trusted settlement identity",
);


assert.match(
  helper,
  /p_settlement_session_id:[\s\S]*settlementSessionId/,
  "R2D2AH-13 helper passes settlement identity into DB RPC",
);


const apiSessionBindings =
  api.match(
    /settlementSessionId:\s*[\r\n]+\s*session\.id/g,
  ) ?? [];


assert.equal(
  apiSessionBindings.length,
  2,
  "R2D2AH-14 claim and release both use server-resolved current settlement",
);


assert.doesNotMatch(
  api,
  /body\?\.settlement_session_id/,
  "R2D2AH-15 browser cannot choose settlement ownership boundary",
);


assert.doesNotMatch(
  api,
  /body\?\.staff_id/,
  "R2D2AH-16 browser still cannot choose Staff identity",
);


assert.match(
  api,
  /"MESSAGE_OUTSIDE_CURRENT_SETTLEMENT"/,
  "R2D2AH-17 API handles historical-settlement rejection safely",
);


assert.match(
  api,
  /"MESSAGE_ROUND_NOT_CURRENT"/,
  "R2D2AH-18 API handles previous-round rejection safely",
);


assert.match(
  api,
  /"MESSAGE_LINE_GROUP_CONFIG_MISMATCH"/,
  "R2D2AH-19 API handles LINE Group\/Summary Group mismatch safely",
);


assert.match(
  api,
  /loadActorSessionLineGroupIds\([\s\S]*session\.id/,
  "R2D2AH-20 Staff LINE Group assignment remains settlement-scoped",
);


console.log(
  "PASS: R2D2A Hardening Current Settlement + Latest Round Claim Scope",
);
