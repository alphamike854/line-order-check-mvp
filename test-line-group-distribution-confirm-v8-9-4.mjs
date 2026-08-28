import assert from 'node:assert/strict';
import fs from 'node:fs';


const confirm = fs.readFileSync(
  new URL(
    './netlify/functions/risk-distribution-confirm.mjs',
    import.meta.url,
  ),
  'utf8',
);


// v3 verifier + version selector.
assert.match(
  confirm,
  /LINE_GROUP_DISTRIBUTION_RUN_TOKEN_VERSION/,
);

assert.match(
  confirm,
  /verifyLineGroupDistributionRunToken/,
);

assert.match(
  confirm,
  /isLineGroupConfirmationToken/,
);

assert.match(
  confirm,
  /confirmLineGroupToken/,
);


// New atomic RPC.
assert.match(
  confirm,
  /confirm_line_group_distribution_run/,
);

assert.match(
  confirm,
  /p_line_group_id:[\s\S]*s\.line_group_id/,
);

assert.match(
  confirm,
  /p_expected_gross_received:[\s\S]*s\.gross_received/,
);

assert.match(
  confirm,
  /p_expected_calculation_band:[\s\S]*s\.calculation_band/,
);

assert.match(
  confirm,
  /p_expected_reduction_pct:[\s\S]*s\.reduction_pct/,
);

assert.match(
  confirm,
  /p_expected_risk_budget:[\s\S]*s\.risk_budget/,
);

assert.match(
  confirm,
  /p_rounds:[\s\S]*verified\.rounds/,
);

assert.match(
  confirm,
  /LINE_GROUP_CATEGORY_RETENTION/,
);


// Critical boundary:
// body may contribute only the signed token.
// Risk-sensitive v3 values must come from verified snapshot.
const lineGroupStart =
  confirm.indexOf(
    'async function confirmLineGroupToken',
  );

const legacyStart =
  confirm.indexOf(
    'async function confirmLegacyToken',
  );

assert.ok(
  lineGroupStart >= 0
  && legacyStart > lineGroupStart,
);

const lineGroupPath =
  confirm.slice(
    lineGroupStart,
    legacyStart,
  );

assert.doesNotMatch(
  lineGroupPath,
  /body\./,
  'v3 confirm path must not consume unsigned request fields',
);

assert.doesNotMatch(
  lineGroupPath,
  /session_overall_risk_state/,
);

assert.doesNotMatch(
  lineGroupPath,
  /session_code_risk_state/,
);

assert.doesNotMatch(
  lineGroupPath,
  /buildRiskDistributionPlan/,
);


// Legacy v2 path remains.
assert.match(
  confirm,
  /verifyDistributionRunToken/,
);

assert.match(
  confirm,
  /confirmLegacyToken/,
);

assert.match(
  confirm,
  /confirm_risk_distribution_run_budget_safe/,
);

assert.match(
  confirm,
  /confirm_separate_risk_distribution_run/,
);

assert.match(
  confirm,
  /LEGACY_SUMMARY_GROUP/,
);


// New RPC safety errors should be surfaced as conflicts,
// not swallowed as generic 500s.
for (const code of [
  'CONFIRMATION_REQUEST_ID_COLLISION',
  'LINE_GROUP_NOT_IN_SETTLEMENT',
  'LINE_GROUP_DISABLED',
  'RETENTION_RECOMMENDATION_MISMATCH',
  'POST_CONFIRM_RETENTION_MISMATCH',
]) {
  assert.match(
    confirm,
    new RegExp(code),
  );
}


// The endpoint itself performs no direct table writes.
assert.doesNotMatch(
  confirm,
  /\.insert\s*\(/,
);

assert.doesNotMatch(
  confirm,
  /\.update\s*\(/,
);

assert.doesNotMatch(
  confirm,
  /\.delete\s*\(/,
);


console.log(
  'PASS: LINE Group distribution confirm endpoint v8.9.4',
);
