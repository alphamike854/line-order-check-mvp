import fs from "node:fs";
import assert from "node:assert/strict";

import {
  buildDashboardFreshness,
  mergeRoundAwarePointMetadata,
} from "./src/lib/dashboard-point-context.mjs";


const dashboard=
  fs.readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  );

const freshness=
  fs.readFileSync(
    "netlify/functions/dashboard-freshness.mjs",
    "utf8",
  );

const helper=
  fs.readFileSync(
    "src/lib/dashboard-point-context.mjs",
    "utf8",
  );

const accounting=
  fs.readFileSync(
    "netlify/functions/accounting-report.mjs",
    "utf8",
  );


console.log(
  "===== Round Dashboard Point Metadata Cutover v1 =====",
);


for(const source of [
  dashboard,
  freshness,
]){
  assert.match(
    source,
    /loadDashboardPointContext/,
  );

  assert.match(
    source,
    /buildDashboardFreshness/,
  );

  assert.doesNotMatch(
    source,
    /\.from\("settlement_point_promotions"\)/,
  );

  assert.doesNotMatch(
    source,
    /\.from\("settlement_summary_group_actual_special_point_codes"\)/,
  );
}

console.log(
  "PASS P3A2-01 Dashboard and freshness share one Round-aware point context boundary",
);


for(const token of [
  "settlement_summary_group_rounds",
  "settlement_summary_group_round_snapshots",
  "settlement_summary_group_point_promotions_current",
  "settlement_point_promotions",
  "settlement_summary_group_actual_special_point_codes_current",
  "settlement_summary_group_actual_special_point_codes",
]){
  assert.match(
    helper,
    new RegExp(token),
  );
}

assert.match(
  helper,
  /CURRENT_ROUND_ARCHIVED/,
);

assert.match(
  helper,
  /CURRENT_ROUND_INVALID_STATUS/,
);

console.log(
  "PASS P3A2-02 current Round source is authoritative with explicit no-Round compatibility sources",
);


const merged=
  mergeRoundAwarePointMetadata({
    rounds:[
      {
        id:"round-north-7",
        round_id:"round-north-7",
        summary_group_id:"NORTH",
        round_no:7,
        status:"CLOSED",
        round_status:"CLOSED",
      },
    ],

    currentPromotions:[
      {
        summary_group_id:"NORTH",
        round_id:"round-north-7",
        round_no:7,
        round_status:"CLOSED",
        category:"A",
        code:"36",
        point_factor_pct:50,
        target_scope:"SELECTED",
        line_group_ids:[
          "LINE-2",
          "LINE-1",
          "LINE-2",
        ],
      },
    ],

    legacyPromotions:[
      {
        summary_group_id:"NORTH",
        category:"A",
        code:"36",
        point_factor_pct:75,
      },
      {
        summary_group_id:"SOUTH",
        category:"B",
        code:"11",
        point_factor_pct:80,
      },
    ],

    currentActual:[
      {
        summary_group_id:"NORTH",
        round_id:"round-north-7",
        round_no:7,
        round_status:"CLOSED",
        category:"A",
        code:"36",
      },
    ],

    legacyActual:[
      {
        summary_group_id:"NORTH",
        category:"A",
        code:"99",
        created_at:"2026-09-10T00:00:00Z",
      },
      {
        summary_group_id:"SOUTH",
        category:"B",
        code:"11",
        created_at:"2026-09-10T00:00:00Z",
      },
    ],
  });


assert.deepEqual(
  merged.promotions.map(
    (row) => [
      row.summary_group_id,
      row.category,
      row.code,
      row.point_factor_pct,
      row.target_scope,
      row.line_group_ids,
      row.round_id,
    ],
  ),
  [
    [
      "NORTH",
      "A",
      "36",
      50,
      "SELECTED",
      ["LINE-1","LINE-2"],
      "round-north-7",
    ],
    [
      "SOUTH",
      "B",
      "11",
      80,
      "ALL",
      [],
      null,
    ],
  ],
);

assert.deepEqual(
  merged.actual.map(
    (row) => [
      row.summary_group_id,
      row.category,
      row.code,
      row.round_id,
    ],
  ),
  [
    [
      "NORTH",
      "A",
      "36",
      "round-north-7",
    ],
    [
      "SOUTH",
      "B",
      "11",
      null,
    ],
  ],
);

console.log(
  "PASS P3A2-03 Round groups ignore legacy mirrors while no-Round groups retain fallback",
);


const northOnly=
  mergeRoundAwarePointMetadata({
    rounds:merged.rounds,

    currentPromotions:
      merged.promotions.filter(
        (row) => row.round_id
      ),

    legacyPromotions:[
      {
        summary_group_id:"SOUTH",
        category:"B",
        code:"11",
        point_factor_pct:80,
      },
    ],

    currentActual:
      merged.actual.filter(
        (row) => row.round_id
      ),

    legacyActual:[
      {
        summary_group_id:"SOUTH",
        category:"B",
        code:"11",
      },
    ],

    summaryGroupId:"NORTH",
  });

assert.equal(
  northOnly.promotions.length,
  1,
);

assert.equal(
  northOnly.actual.length,
  1,
);

assert.equal(
  northOnly.rounds.length,
  1,
);

console.log(
  "PASS P3A2-04 selected Summary Group scopes Round metadata consistently",
);


const baseInput={
  sessionId:"session-1",
  messageAt:"2026-09-10T10:00:00Z",
  transferAt:"2026-09-10T10:10:00Z",
  settingsAt:"2026-09-10T10:20:00Z",

  rounds:[
    {
      summary_group_id:"NORTH",
      round_id:"round-north-7",
      round_no:7,
      round_status:"CLOSED",
    },
  ],

  actualCodes:[
    {
      summary_group_id:"NORTH",
      round_id:"round-north-7",
      category:"A",
      code:"36",
    },
  ],

  promotions:[
    {
      summary_group_id:"NORTH",
      round_id:"round-north-7",
      category:"A",
      code:"36",
      point_factor_pct:50,
      target_scope:"SELECTED",
      line_group_ids:[
        "LINE-2",
        "LINE-1",
      ],
    },
  ],

  warehouseLimits:[
    {
      destination:"W1",
      max_batch_quantity:100,
      updated_at:"2026-09-10T01:00:00Z",
    },
  ],

  riskBudgets:[
    {
      summary_group_id:"NORTH",
      risk_pool:"MAIN",
      point_loss_tolerance:10,
      updated_at:"2026-09-10T02:00:00Z",
    },
  ],
};


const base=
  buildDashboardFreshness(
    baseInput
  );


const reorderedTargets=
  buildDashboardFreshness({
    ...baseInput,

    promotions:[
      {
        ...baseInput.promotions[0],
        line_group_ids:[
          "LINE-1",
          "LINE-2",
        ],
      },
    ],
  });

assert.equal(
  base.version,
  reorderedTargets.version,
);

console.log(
  "PASS P3A2-05 SELECTED target ordering is deterministic",
);


const changedTarget=
  buildDashboardFreshness({
    ...baseInput,

    promotions:[
      {
        ...baseInput.promotions[0],
        line_group_ids:[
          "LINE-1",
          "LINE-3",
        ],
      },
    ],
  });

assert.notEqual(
  base.version,
  changedTarget.version,
);


const changedScope=
  buildDashboardFreshness({
    ...baseInput,

    promotions:[
      {
        ...baseInput.promotions[0],
        target_scope:"ALL",
        line_group_ids:[],
      },
    ],
  });

assert.notEqual(
  base.version,
  changedScope.version,
);


const changedRound=
  buildDashboardFreshness({
    ...baseInput,

    rounds:[
      {
        ...baseInput.rounds[0],
        round_id:"round-north-8",
        round_no:8,
        round_status:"OPEN",
      },
    ],

    actualCodes:[
      {
        ...baseInput.actualCodes[0],
        round_id:"round-north-8",
      },
    ],

    promotions:[
      {
        ...baseInput.promotions[0],
        round_id:"round-north-8",
      },
    ],
  });

assert.notEqual(
  base.version,
  changedRound.version,
);


const changedActual=
  buildDashboardFreshness({
    ...baseInput,

    actualCodes:[
      {
        ...baseInput.actualCodes[0],
        code:"37",
      },
    ],
  });

assert.notEqual(
  base.version,
  changedActual.version,
);

console.log(
  "PASS P3A2-06 freshness detects target, scope, Round and Actual Point changes",
);


assert.match(
  freshness,
  /normalizeSummaryGroup/,
);

assert.match(
  freshness,
  /scopedMessageQuery\s*=\s*scopedMessageQuery\.eq\(\s*"summary_group_id"/s,
);

console.log(
  "PASS P3A2-07 dashboard-freshness honors selected Summary Group",
);


assert.match(
  accounting,
  /accounting_round_point_context/,
);

assert.match(
  accounting,
  /pointContext\.actual_special_point_codes/,
);

assert.doesNotMatch(
  accounting,
  /loadDashboardPointContext/,
);

console.log(
  "PASS P3A2-08 Accounting follows later exact-Round Point/Promotion cutover",
);


assert.match(
  dashboard,
  /riskCodes/,
);

assert.match(
  dashboard,
  /categoryRisk/,
);

assert.match(
  dashboard,
  /overallRisk/,
);

console.log(
  "PASS P3A2-09 production Risk payload remains on existing P3A1 views",
);


console.log(
  "PASS: Round Dashboard Point Metadata Cutover v1",
);
