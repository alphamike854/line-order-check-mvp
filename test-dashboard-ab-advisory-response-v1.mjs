import assert from "node:assert/strict";
import fs from "node:fs";

const dashboard =
  fs.readFileSync(
    new URL(
      "./netlify/functions/dashboard.mjs",
      import.meta.url
    ),
    "utf8"
  );

const scopeCore =
  fs.readFileSync(
    new URL(
      "./src/lib/ab-advisory-scope.mjs",
      import.meta.url
    ),
    "utf8"
  );

/*
 * Dashboard integration contract.
 */
assert.match(
  dashboard,
  /buildAbAdvisoryScopes/
);

assert.match(
  dashboard,
  /AB_ADVISORY_SHARED_MAX_LOSS=200000/
);

assert.match(
  dashboard,
  /summaryRows:riskCodes/
);

assert.match(
  dashboard,
  /lineGroupRows:lineGroupRiskCodes/
);

assert.match(
  dashboard,
  /sharedMaxLoss:[\s\S]*AB_ADVISORY_SHARED_MAX_LOSS/
);

assert.match(
  dashboard,
  /ab_advisory:abAdvisory/
);

/*
 * Failure isolation:
 * advisory error must be captured,
 * not thrown through the Dashboard endpoint.
 */
assert.match(
  dashboard,
  /try\s*\{[\s\S]*buildAbAdvisoryScopes/
);

assert.match(
  dashboard,
  /catch\(error\)[\s\S]*dashboard A\/B advisory failed/
);

assert.match(
  dashboard,
  /calculation_status:"ERROR"/
);

/*
 * Reuse existing Dashboard snapshot rows.
 * Scope core must have no DB/network dependency.
 */
assert.doesNotMatch(
  scopeCore,
  /\bsupabase\b/
);

assert.doesNotMatch(
  scopeCore,
  /\.from\(/
);

assert.doesNotMatch(
  scopeCore,
  /\.rpc\(/
);

assert.doesNotMatch(
  scopeCore,
  /\bfetch\(/
);

/*
 * Existing legacy risk response remains present.
 */
assert.match(
  dashboard,
  /distribution_plans:distributionPlans/
);

assert.match(
  dashboard,
  /line_group_distribution_plans:lineGroupDistributionPlans/
);

assert.match(
  dashboard,
  /risk_codes:riskCodes/
);

console.log(
  "PASS: Dashboard exposes A/B advisory response"
);

console.log(
  "PASS: advisory reuses loaded risk snapshot rows"
);

console.log(
  "PASS: advisory failure is isolated from Dashboard"
);

console.log(
  "PASS: existing distribution response retained"
);

console.log(
  "PASS: scope core has no DB/network dependency"
);
