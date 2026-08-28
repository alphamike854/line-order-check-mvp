import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  createDistributionRunToken,
  verifyDistributionRunToken,
  createLineGroupDistributionRunToken,
  verifyLineGroupDistributionRunToken,
} from './src/lib/distribution-run-safety.mjs';

import {
  splitLineGroupDistributionRounds,
} from './src/lib/distribution-round-planner.mjs';


const KEY = 'test-line-group-signing-key';


// Legacy v2 token must remain operational.
const legacy = createDistributionRunToken({
  riskState: {
    settlement_session_id:
      '11111111-1111-1111-1111-111111111111',
    summary_group_id: 'NORTH',
    risk_pool: 'MAIN',
    risk_mode: 'RESERVE',
    adjusted_received: 100000,
    risk_point_total: 120000,
    safety_margin: -20000,
    risk_pct: 120,
    point_loss_tolerance: 0,
    risk_budget: 100000,
    excess_point_risk: 20000,
    confirmed_cut_total: 0,
  },

  rounds: [{
    destination: 'WH1',
    destination_limit: 100,
    items: [{
      category: 'A',
      code: '01',
      quantity: 10,
      expected_retained_quantity: 20,
      expected_effective_multiplier: 70,
    }],
  }],

  projectedRisk: {
    projected_point_reserve: 119300,
    projected_excess_point_risk: 19300,
  },

  key: KEY,
});

assert.match(
  legacy.token,
  /^v2\./,
);

assert.equal(
  verifyDistributionRunToken({
    token: legacy.token,
    key: KEY,
  }).ok,
  true,
);


// Current production example:
// A70 = 7,703
// retention limit = 1,714
// recommendation = 5,989.
const plan =
  splitLineGroupDistributionRounds({
    targets: [{
      line_group_id:
        'C87107089a6e03db9ca197b90d3cfebe4',
      category: 'A',
      code: '70',
      quantity: 5989,
      expected_retained_quantity: 7703,
      expected_effective_multiplier: 70,
      retention_limit: 1714,
    }],

    warehouses: [
      {
        destination: 'WH1',
        max_batch_quantity: 3000,
      },
      {
        destination: 'WH2',
        max_batch_quantity: 3000,
      },
    ],
  });

assert.equal(
  plan.line_group_id,
  'C87107089a6e03db9ca197b90d3cfebe4',
);

assert.equal(
  plan.total_quantity,
  5989,
);

assert.equal(
  plan.round_count,
  2,
);

assert.equal(
  plan.rounds[0].items[0].line_group_id,
  'C87107089a6e03db9ca197b90d3cfebe4',
);

assert.equal(
  plan.rounds[0].items[0].retention_limit,
  1714,
);

assert.equal(
  plan.rounds[0].items[0].quantity,
  3000,
);

assert.equal(
  plan.rounds[1].items[0].quantity,
  2989,
);


const signed =
  createLineGroupDistributionRunToken({
    riskState: {
      settlement_session_id:
        '11111111-1111-1111-1111-111111111111',

      line_group_id:
        'C87107089a6e03db9ca197b90d3cfebe4',

      summary_group_id: 'NORTH',

      risk_pool: 'MAIN',

      risk_model:
        'CATEGORY_RETENTION',

      gross_received: 487174,

      calculation_band: 400000,

      reduction_pct: 40,

      risk_budget: 240000,
    },

    rounds: plan.rounds,

    key: KEY,
  });

assert.match(
  signed.token,
  /^v3\./,
);

const verified =
  verifyLineGroupDistributionRunToken({
    token: signed.token,
    key: KEY,
  });

assert.equal(
  verified.ok,
  true,
);

assert.equal(
  verified.snapshot.line_group_id,
  'C87107089a6e03db9ca197b90d3cfebe4',
);

assert.equal(
  verified.snapshot.risk_model,
  'CATEGORY_RETENTION',
);

assert.equal(
  verified.planned_quantity,
  5989,
);

assert.equal(
  verified.rounds[1].items[0].retention_limit,
  1714,
);


// A run must never mix LINE Groups.
assert.throws(
  () => splitLineGroupDistributionRounds({
    targets: [
      {
        line_group_id: 'GROUP-1',
        category: 'A',
        code: '01',
        quantity: 10,
        expected_retained_quantity: 20,
        expected_effective_multiplier: 70,
        retention_limit: 10,
      },
      {
        line_group_id: 'GROUP-2',
        category: 'A',
        code: '02',
        quantity: 10,
        expected_retained_quantity: 20,
        expected_effective_multiplier: 70,
        retention_limit: 10,
      },
    ],
    warehouses: [{
      destination: 'WH1',
      max_batch_quantity: 100,
    }],
  }),
  /MIXED_LINE_GROUP_DISTRIBUTION_NOT_ALLOWED/,
);


// Recommendation must equal retained - limit.
assert.throws(
  () => splitLineGroupDistributionRounds({
    targets: [{
      line_group_id: 'GROUP-1',
      category: 'A',
      code: '01',
      quantity: 9,
      expected_retained_quantity: 20,
      expected_effective_multiplier: 70,
      retention_limit: 10,
    }],
    warehouses: [{
      destination: 'WH1',
      max_batch_quantity: 100,
    }],
  }),
  /RETENTION_RECOMMENDATION_MISMATCH/,
);


// Token must reject a round from another LINE Group.
assert.throws(
  () => createLineGroupDistributionRunToken({
    riskState: {
      settlement_session_id:
        '11111111-1111-1111-1111-111111111111',
      line_group_id: 'GROUP-1',
      summary_group_id: 'NORTH',
      risk_pool: 'MAIN',
      risk_model: 'CATEGORY_RETENTION',
      gross_received: 100000,
      calculation_band: 100000,
      reduction_pct: 40,
      risk_budget: 60000,
    },
    rounds: [{
      destination: 'WH1',
      destination_limit: 100,
      items: [{
        line_group_id: 'GROUP-2',
        category: 'A',
        code: '01',
        quantity: 10,
        expected_retained_quantity: 20,
        expected_effective_multiplier: 70,
        retention_limit: 10,
      }],
    }],
    key: KEY,
  }),
  /LINE_GROUP_MISMATCH/,
);


// A partial recommendation may be split across rounds,
// but the signed total must equal retained - limit.
assert.throws(
  () => createLineGroupDistributionRunToken({
    riskState: {
      settlement_session_id:
        '11111111-1111-1111-1111-111111111111',
      line_group_id: 'GROUP-1',
      summary_group_id: 'NORTH',
      risk_pool: 'MAIN',
      risk_model: 'CATEGORY_RETENTION',
      gross_received: 100000,
      calculation_band: 100000,
      reduction_pct: 40,
      risk_budget: 60000,
    },
    rounds: [{
      destination: 'WH1',
      destination_limit: 100,
      items: [{
        line_group_id: 'GROUP-1',
        category: 'A',
        code: '01',
        quantity: 5,
        expected_retained_quantity: 20,
        expected_effective_multiplier: 70,
        retention_limit: 10,
      }],
    }],
    key: KEY,
  }),
  /LINE_GROUP_RECOMMENDATION_INCOMPLETE/,
);


const migration = fs.readFileSync(
  'supabase/migrations/20260828040000_add_line_group_distribution_attribution.sql',
  'utf8',
);

assert.match(
  migration,
  /settlement_distribution_runs[\s\S]*line_group_id/,
);

assert.match(
  migration,
  /settlement_transfer_batches[\s\S]*line_group_id/,
);

assert.match(
  migration,
  /settlement_transfer_batch_items[\s\S]*line_group_id/,
);

assert.match(
  migration,
  /retention_limit/,
);

assert.doesNotMatch(
  migration,
  /\bupdate\s+public\.settlement_/i,
  'legacy transfer history must not be guessed or backfilled',
);

console.log(
  'PASS: LINE Group distribution contract v8.9.4',
);
