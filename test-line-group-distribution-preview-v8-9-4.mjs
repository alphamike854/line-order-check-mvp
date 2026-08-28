import assert from 'node:assert/strict';
import fs from 'node:fs';

const preview = fs.readFileSync(
  new URL(
    './netlify/functions/risk-distribution-preview.mjs',
    import.meta.url,
  ),
  'utf8',
);


// New LINE Group path exists.
assert.match(
  preview,
  /body\.line_group_id/,
);

assert.match(
  preview,
  /previewLineGroupRetention/,
);

assert.match(
  preview,
  /session_line_group_risk_state/,
);

assert.match(
  preview,
  /session_line_group_code_retention_state/,
);

assert.match(
  preview,
  /splitLineGroupDistributionRounds/,
);

assert.match(
  preview,
  /createLineGroupDistributionRunToken/,
);

assert.match(
  preview,
  /LINE_GROUP_CATEGORY_RETENTION/,
);

assert.match(
  preview,
  /confirmation_token_version:[\s\S]*'v3'/,
);


// Recommendation comes directly from retained-policy DB state.
assert.match(
  preview,
  /quantity:[\s\S]*Number\([\s\S]*row\.recommended_cut/,
);

assert.match(
  preview,
  /expected_retained_quantity:[\s\S]*row\.retained_quantity/,
);

assert.match(
  preview,
  /expected_effective_multiplier:[\s\S]*row\.effective_multiplier/,
);

assert.match(
  preview,
  /retention_limit:[\s\S]*row\.retention_limit/,
);


// Integrity error must block preview.
assert.match(
  preview,
  /RISK_DATA_INTEGRITY_ERROR/,
);

assert.match(
  preview,
  /confirmed_cut_exceeds_order_total/,
);


// New branch must happen before the legacy fallback.
const lineGroupBranch =
  preview.indexOf(
    'if (lineGroupId)',
  );

const legacyFallback =
  preview.indexOf(
    'return await previewLegacySummaryGroup',
  );

assert.ok(
  lineGroupBranch >= 0,
  'LINE Group preview branch missing',
);

assert.ok(
  legacyFallback > lineGroupBranch,
  'legacy fallback must remain after LINE Group branch',
);


// Inspect only the new function body:
// it must not use legacy unit-loop helpers.
const newStart =
  preview.indexOf(
    'async function previewLineGroupRetention',
  );

const legacyStart =
  preview.indexOf(
    'async function previewLegacySummaryGroup',
  );

assert.ok(
  newStart >= 0 && legacyStart > newStart,
);

const newPath =
  preview.slice(
    newStart,
    legacyStart,
  );

assert.doesNotMatch(
  newPath,
  /buildRiskDistributionPlan/,
  'LINE Group preview must not use legacy unit simulation',
);

assert.doesNotMatch(
  newPath,
  /projectRiskAfterTransfers/,
  'LINE Group preview must not use legacy Point projection planner',
);

assert.doesNotMatch(
  newPath,
  /session_code_risk_state/,
  'LINE Group preview must not read Summary Group code state',
);

assert.doesNotMatch(
  newPath,
  /session_overall_risk_state/,
);

assert.doesNotMatch(
  newPath,
  /session_risk_pool_state/,
);


// Legacy path is deliberately preserved during staged migration.
const legacyPath =
  preview.slice(
    legacyStart,
  );

assert.match(
  legacyPath,
  /buildRiskDistributionPlan/,
);

assert.match(
  legacyPath,
  /projectRiskAfterTransfers/,
);

assert.match(
  legacyPath,
  /splitDistributionRounds/,
);

assert.match(
  legacyPath,
  /createDistributionRunToken/,
);

assert.match(
  legacyPath,
  /session_code_risk_state/,
);


// Preview must remain read-only.
assert.doesNotMatch(
  preview,
  /\.insert\s*\(/,
);

assert.doesNotMatch(
  preview,
  /\.update\s*\(/,
);

assert.doesNotMatch(
  preview,
  /\.delete\s*\(/,
);

assert.doesNotMatch(
  preview,
  /\.rpc\s*\(/,
);


console.log(
  'PASS: LINE Group distribution preview v8.9.4',
);
