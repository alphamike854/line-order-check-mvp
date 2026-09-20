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
  /DEFAULT_AB_SHARED_MAX_LOSS/
);

assert.match(
  dashboard,
  /const AB_ADVISORY_SHARED_MAX_LOSS=DEFAULT_AB_SHARED_MAX_LOSS/
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
  /sharedMaxLoss:[\s\S]*abLossSetting\.shared_max_loss/
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

/*
 * Dynamic MAIN loss tolerance integration.
 * Positive configured value is eligible.
 * Missing/zero remains fail-safe at 200000.
 */
assert.match(
  dashboard,
  /resolveAbSharedMaxLoss/
);

assert.match(
  dashboard,
  /rows:riskBudgetResult\?\.data\s*\|\|\s*\[\]/
);

assert.match(
  dashboard,
  /summaryGroupId/
);

assert.match(
  dashboard,
  /sharedMaxLoss:[\s\S]*abLossSetting\.shared_max_loss/
);

console.log(
  "PASS: Dashboard A/B advisory uses fail-safe dynamic MAIN loss setting"
);


/*
 * A/B dynamic loss resolver direct regression
 */
const dynamicLossModule =
  await import(
    "./src/lib/ab-advisory-loss-setting.mjs"
  );

const {
  DEFAULT_AB_SHARED_MAX_LOSS,
  resolveAbSharedMaxLoss,
} = dynamicLossModule;

assert.equal(
  DEFAULT_AB_SHARED_MAX_LOSS,
  200000
);

const configuredNorth =
  resolveAbSharedMaxLoss({
    summaryGroupId: "NORTH",
    rows: [{
      summary_group_id: "NORTH",
      risk_pool: "MAIN",
      point_loss_tolerance: 250000,
    }],
  });

assert.deepEqual(
  configuredNorth,
  {
    shared_max_loss: 250000,
    source: "MAIN_POINT_LOSS_TOLERANCE",
  }
);

const zeroNorth =
  resolveAbSharedMaxLoss({
    summaryGroupId: "NORTH",
    rows: [{
      summary_group_id: "NORTH",
      risk_pool: "MAIN",
      point_loss_tolerance: 0,
    }],
  });

assert.deepEqual(
  zeroNorth,
  {
    shared_max_loss: 200000,
    source: "FALLBACK_200000",
  }
);

const missingEast =
  resolveAbSharedMaxLoss({
    summaryGroupId: "EAST",
    rows: [],
  });

assert.equal(
  missingEast.shared_max_loss,
  200000
);

const hMustNotAffectAb =
  resolveAbSharedMaxLoss({
    summaryGroupId: "NORTH",
    rows: [{
      summary_group_id: "NORTH",
      risk_pool: "H",
      point_loss_tolerance: 999999,
    }],
  });

assert.equal(
  hMustNotAffectAb.shared_max_loss,
  200000
);

const groupIsolation =
  resolveAbSharedMaxLoss({
    summaryGroupId: "SOUTH",
    rows: [
      {
        summary_group_id: "NORTH",
        risk_pool: "MAIN",
        point_loss_tolerance: 300000,
      },
      {
        summary_group_id: "SOUTH",
        risk_pool: "MAIN",
        point_loss_tolerance: 150000,
      },
    ],
  });

assert.equal(
  groupIsolation.shared_max_loss,
  150000
);

const rounded =
  resolveAbSharedMaxLoss({
    summaryGroupId: "WEST",
    rows: [{
      summary_group_id: "WEST",
      risk_pool: "MAIN",
      point_loss_tolerance: 123456.789,
    }],
  });

assert.equal(
  rounded.shared_max_loss,
  123456.79
);

assert.throws(
  () =>
    resolveAbSharedMaxLoss({
      fallback: -1,
    }),
  /AB_SHARED_MAX_LOSS_FALLBACK_INVALID/
);

console.log(
  "PASS: A/B dynamic loss resolver direct regression"
);
