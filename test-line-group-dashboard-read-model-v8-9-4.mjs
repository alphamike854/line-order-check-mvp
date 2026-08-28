import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(
  new URL(
    './netlify/functions/dashboard.mjs',
    import.meta.url,
  ),
  'utf8',
);


// New LINE Group DB read models.
assert.match(
  dashboard,
  /session_line_group_risk_state/,
);

assert.match(
  dashboard,
  /session_line_group_code_retention_state/,
);


// New response collections.
assert.match(
  dashboard,
  /line_group_risk:lineGroupRisk/,
);

assert.match(
  dashboard,
  /line_group_risk_codes:lineGroupRiskCodes/,
);

assert.match(
  dashboard,
  /line_group_distribution_plans:lineGroupDistributionPlans/,
);


// Empty-settlement response must preserve response shape.
assert.match(
  dashboard,
  /line_group_risk:\[\]/,
);

assert.match(
  dashboard,
  /line_group_risk_codes:\[\]/,
);

assert.match(
  dashboard,
  /line_group_distribution_plans:\[\]/,
);


// Summary Group filter propagates to both LINE Group views.
assert.match(
  dashboard,
  /lineGroupRiskQuery=lineGroupRiskQuery\.eq\("summary_group_id",summaryGroupId\)/,
);

assert.match(
  dashboard,
  /lineGroupCodeQuery=lineGroupCodeQuery\.eq\("summary_group_id",summaryGroupId\)/,
);


// Isolate new LINE Group planner from legacy planner.
const lineGroupStart = dashboard.indexOf(
  'const lineGroupDistributionPlans=',
);

const legacyStart = dashboard.indexOf(
  'const distributionPlans=',
);

assert.ok(
  lineGroupStart >= 0,
  'LINE Group distribution plans missing',
);

assert.ok(
  legacyStart > lineGroupStart,
  'legacy distribution plans must remain after LINE Group plans',
);

const lineGroupPath = dashboard.slice(
  lineGroupStart,
  legacyStart,
);


// New path uses retained-state recommendation directly.
assert.match(
  lineGroupPath,
  /row\.recommended_cut/,
);

assert.match(
  lineGroupPath,
  /row\.retained_quantity/,
);

assert.match(
  lineGroupPath,
  /row\.retention_limit/,
);

assert.match(
  lineGroupPath,
  /row\.effective_multiplier/,
);

assert.match(
  lineGroupPath,
  /row\.recommended_point_reduction/,
);

assert.match(
  lineGroupPath,
  /CUT_REQUIRED/,
);


// Integrity failures block operational recommendations.
assert.match(
  lineGroupPath,
  /DATA_INTEGRITY_ERROR/,
);

assert.match(
  lineGroupPath,
  /confirmed_cut_exceeds_order_total/,
);


// First 100k band / other non-ready states must be retained
// from the DB state rather than simulated locally.
assert.match(
  lineGroupPath,
  /risk\.calculation_status==="READY"/,
);

assert.match(
  lineGroupPath,
  /risk\.calculation_status[\s\S]*"NOT_READY"/,
);


// MAIN/H/L remain isolated presentation/confirmation pools.
assert.match(
  lineGroupPath,
  /\["MAIN","H","L"\]/,
);

assert.match(
  lineGroupPath,
  /RISK_POOL_CATEGORIES\[riskPool\]/,
);


// Critical: LINE Group plan must not invoke legacy unit simulation.
assert.doesNotMatch(
  lineGroupPath,
  /buildRiskDistributionPlan/,
);

assert.doesNotMatch(
  lineGroupPath,
  /maxSimulationUnits/,
);

assert.doesNotMatch(
  lineGroupPath,
  /session_code_risk_state/,
);


// Legacy dashboard model remains for current production UI.
const legacyPath = dashboard.slice(
  legacyStart,
);

assert.match(
  legacyPath,
  /buildRiskDistributionPlan/,
);

assert.match(
  legacyPath,
  /maxSimulationUnits:5000/,
);

assert.match(
  dashboard,
  /distribution_plans:distributionPlans/,
);


// Dashboard endpoint remains read-only.
assert.doesNotMatch(
  dashboard,
  /\.insert\s*\(/,
);

assert.doesNotMatch(
  dashboard,
  /\.update\s*\(/,
);

assert.doesNotMatch(
  dashboard,
  /\.delete\s*\(/,
);

assert.doesNotMatch(
  dashboard,
  /\.rpc\s*\(/,
);


console.log(
  'PASS: LINE Group dashboard read model v8.9.4',
);
