import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(
  new URL('./public/app.js', import.meta.url),
  'utf8',
);

const html = fs.readFileSync(
  new URL('./public/index.html', import.meta.url),
  'utf8',
);


// =========================================================
// 1. Allocation LINE Group selector exists exactly once.
// =========================================================

assert.equal(
  (
    html.match(
      /id="allocationLineGroupSelect"/g
    ) || []
  ).length,
  1,
);

assert.match(
  html,
  /<select id="allocationLineGroupSelect">/,
);


// =========================================================
// 2. Frontend reads LINE Group dashboard model.
// =========================================================

assert.match(
  app,
  /const allocationLineGroupSelect = \$\("#allocationLineGroupSelect"\)/,
);

assert.match(
  app,
  /state\.dashboard\?\.line_group_risk/,
);

assert.match(
  app,
  /state\.dashboard\?\.line_group_risk_codes/,
);

assert.match(
  app,
  /state\.dashboard\?\.line_group_distribution_plans/,
);

assert.match(
  app,
  /function allocationLineGroupRiskFor/,
);

assert.match(
  app,
  /function lineGroupDistributionPlanFor/,
);

assert.match(
  app,
  /function lineGroupRecommendationMapFor/,
);

assert.match(
  app,
  /function lineGroupCodeRowsFor/,
);

assert.match(
  app,
  /function syncAllocationLineGroupOptions/,
);


// =========================================================
// 3. Allocation board carries exact LINE Group identity.
// =========================================================

assert.match(
  app,
  /data-line-group="\$\{escapeHtml\(lineGroupId\)\}"/,
);

assert.match(
  app,
  /line_group_id: input\.dataset\.lineGroup \|\| ""/,
);


// =========================================================
// 4. Allocation uses retention model.
// =========================================================

assert.match(
  app,
  /retention_limit/,
);

assert.match(
  app,
  /retained_quantity/,
);

assert.match(
  app,
  /recommended_transfer/,
);

assert.match(
  app,
  /WAITING_FIRST_BAND/,
);

assert.match(
  app,
  /DATA_INTEGRITY_ERROR/,
);

assert.match(
  app,
  /CATEGORY_RETENTION/,
);


// =========================================================
// 5. Isolate operational write path.
// =========================================================

const runStart =
  app.indexOf(
    'async function runBulkDistribution() {'
  );

const historyStart =
  app.indexOf(
    'async function loadAllocationHistory',
    runStart,
  );

assert.ok(
  runStart >= 0,
  'runBulkDistribution missing',
);

assert.ok(
  historyStart > runStart,
  'loadAllocationHistory boundary missing',
);

const run =
  app.slice(
    runStart,
    historyStart,
  );


// Exact LINE Group request identity.
assert.match(
  run,
  /line_group_id:\s*lineGroupId/,
);

assert.match(
  run,
  /summary_group_id:\s*groupId/,
);

assert.match(
  run,
  /risk_pool:\s*riskPool/,
);

assert.match(
  run,
  /selected_codes:\s*codes/,
);


// v3 preview is mandatory.
assert.match(
  run,
  /preview\.preview_mode[\s\S]*LINE_GROUP_CATEGORY_RETENTION/,
);

assert.match(
  run,
  /preview\.confirmation_token_version[\s\S]*"v3"/,
);

assert.match(
  run,
  /LINE_GROUP_PREVIEW_REQUIRED/,
);

assert.match(
  run,
  /LINE_GROUP_CONFIRMATION_TOKEN_REQUIRED/,
);


// Mixed LINE Group selection must be rejected.
assert.match(
  run,
  /item\.line_group_id !== lineGroupId/,
);


// =========================================================
// 6. Legacy planner cannot authorize B3 write path.
// =========================================================

assert.doesNotMatch(
  run,
  /anyDistributionPlanCalculationFailed/,
);

assert.doesNotMatch(
  run,
  /\bdistributionPlanFor\(/,
);

assert.doesNotMatch(
  run,
  /recommendationMapFor\(groupId/,
);

assert.doesNotMatch(
  run,
  /buildRiskDistributionPlan/,
);


// =========================================================
// 7. Confirm must send only signed token.
// =========================================================

const confirmStart =
  run.indexOf(
    '"/api/risk-distribution-confirm"'
  );

assert.ok(
  confirmStart >= 0,
  'confirmation endpoint missing',
);

const confirmWindow =
  run.slice(
    confirmStart,
    confirmStart + 800,
  );

assert.match(
  confirmWindow,
  /confirmation_token:\s*preview\.confirmation_token/,
);

assert.doesNotMatch(
  confirmWindow,
  /line_group_id:/,
);

assert.doesNotMatch(
  confirmWindow,
  /summary_group_id:/,
);

assert.doesNotMatch(
  confirmWindow,
  /risk_budget:/,
);

assert.doesNotMatch(
  confirmWindow,
  /calculation_band:/,
);

assert.doesNotMatch(
  confirmWindow,
  /rounds:/,
);


// =========================================================
// 8. B2 safety lock must be removed.
// =========================================================

assert.doesNotMatch(
  app,
  /Phase 2F-B2 safety lock/,
);

const summaryStart =
  app.indexOf(
    'function updateBulkDistributionSummary('
  );

const poolStart =
  app.indexOf(
    'function renderAllocationPoolStatus',
    summaryStart,
  );

assert.ok(
  summaryStart >= 0
  && poolStart > summaryStart,
);

const summary =
  app.slice(
    summaryStart,
    poolStart,
  );

assert.match(
  summary,
  /button\.disabled\s*=\s*[\s\S]*state\.dashboardStale[\s\S]*required <= 0[\s\S]*!codes\.length[\s\S]*!warehouses\.length/,
);


// =========================================================
// 9. Selector change re-renders Allocation only.
// =========================================================

assert.match(
  app,
  /allocationLineGroupSelect\.addEventListener\("change"/,
);

assert.match(
  app,
  /allocationLineGroupSelect\.addEventListener\("change"[\s\S]*clearTransferPreview\(\)[\s\S]*renderAllocation\(\)/,
);



// Allocation rows prioritize highest order volume.
assert.match(
  app,
  /Number\(b\.order_total \|\| 0\)[\s\S]*Number\(a\.order_total \|\| 0\)/
);


// Compact Top 20 operational allocation board.
assert.match(
  app,
  /function topAllocationVisibleCodes/
);

assert.match(
  app,
  /\.slice\(0,\s*limit\)/
);

assert.match(
  app,
  /Number\(row\.order_total \|\| 0\) > 0/
);

// v9.2: rows outside Top 20 remain accessible through
// expandable overflow instead of permanent display:none.
assert.match(
  app,
  /function renderRankedOverflow/
);

assert.match(
  app,
  /class="ranked-overflow"/
);

// Operational rows outside Top 20 must remain visible.
assert.match(
  app,
  /top \|\| recommended > 0/
);

assert.match(
  app,
  /allocation-compact-code/
);

assert.match(
  app,
  /allocation-compact-qty/
);

console.log(
  'PASS: LINE Group allocation UI cutover v8.9.4',
);
