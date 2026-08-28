import assert from "node:assert/strict";
import fs from "node:fs";

import {
  calculateCategoryRetentionLimit,
  calculateCodeRetentionRecommendation,
  categoryRiskBudgetDivisor,
} from "./src/lib/risk-engine.mjs";


assert.equal(
  categoryRiskBudgetDivisor("A", 1),
  2,
);

assert.equal(
  categoryRiskBudgetDivisor("B", 1),
  2,
);

assert.equal(
  categoryRiskBudgetDivisor("E", 1),
  1,
);

assert.equal(
  categoryRiskBudgetDivisor("F", 6),
  6,
);

assert.equal(
  categoryRiskBudgetDivisor("G", 4),
  4,
);

assert.equal(
  categoryRiskBudgetDivisor("H", 3),
  3,
);

assert.equal(
  categoryRiskBudgetDivisor("L", 2),
  2,
);


// Business example: 1,000,000 band with 40% reduction.
// Risk Budget = 600,000.
assert.equal(
  calculateCategoryRetentionLimit({
    category: "A",
    riskBudget: 600000,
    multiplier: 70,
    maxSpecialCodes: 1,
  }),
  4285,
);

assert.equal(
  calculateCategoryRetentionLimit({
    category: "B",
    riskBudget: 600000,
    multiplier: 70,
    maxSpecialCodes: 1,
  }),
  4285,
);

assert.equal(
  calculateCategoryRetentionLimit({
    category: "E",
    riskBudget: 600000,
    multiplier: 550,
    maxSpecialCodes: 1,
  }),
  1090,
);

assert.equal(
  calculateCategoryRetentionLimit({
    category: "F",
    riskBudget: 600000,
    multiplier: 100,
    maxSpecialCodes: 6,
  }),
  1000,
);

assert.equal(
  calculateCategoryRetentionLimit({
    category: "G",
    riskBudget: 600000,
    multiplier: 100,
    maxSpecialCodes: 4,
  }),
  1500,
);

assert.equal(
  calculateCategoryRetentionLimit({
    category: "H",
    riskBudget: 600000,
    multiplier: 3,
    maxSpecialCodes: 3,
  }),
  66666,
);

assert.equal(
  calculateCategoryRetentionLimit({
    category: "L",
    riskBudget: 600000,
    multiplier: 4,
    maxSpecialCodes: 2,
  }),
  75000,
);


// Current production example:
// Group = 487,174
// Band = 400,000
// Risk Budget = 240,000.
assert.equal(
  calculateCategoryRetentionLimit({
    category: "A",
    riskBudget: 240000,
    multiplier: 70,
    maxSpecialCodes: 1,
  }),
  1714,
);

assert.equal(
  calculateCategoryRetentionLimit({
    category: "E",
    riskBudget: 240000,
    multiplier: 550,
    maxSpecialCodes: 1,
  }),
  436,
);

assert.equal(
  calculateCategoryRetentionLimit({
    category: "F",
    riskBudget: 240000,
    multiplier: 100,
    maxSpecialCodes: 6,
  }),
  400,
);


// Production A70 currently has 7,703.
const a70 = calculateCodeRetentionRecommendation({
  category: "A",
  quantity: 7703,
  riskBudget: 240000,
  multiplier: 70,
  maxSpecialCodes: 1,
});

assert.deepEqual(
  a70,
  {
    category: "A",
    quantity: 7703,
    risk_budget: 240000,
    effective_multiplier: 70,
    budget_divisor: 2,
    retention_limit: 1714,
    recommended_cut: 5989,
    projected_retained: 1714,
    projected_point_exposure: 119980,
    recommended_point_reduction: 419230,
  },
);


// A/B together at their limits stay within 240,000.
assert.equal(
  1714 * 70 * 2,
  239960,
);


// Promotion increases the safe retained quantity because the effective
// Point multiplier is lower.
assert.equal(
  calculateCategoryRetentionLimit({
    category: "E",
    riskBudget: 240000,
    multiplier: 550,
    maxSpecialCodes: 1,
    promotionFactorPct: 50,
  }),
  872,
);


assert.throws(
  () => calculateCategoryRetentionLimit({
    category: "X",
    riskBudget: 240000,
    multiplier: 70,
    maxSpecialCodes: 1,
  }),
  /INVALID_RISK_CATEGORY/,
);


const migration = fs.readFileSync(
  "supabase/migrations/20260828035000_add_line_group_retention_limits.sql",
  "utf8",
);

assert.match(
  migration,
  /session_line_group_code_retention_state/,
);

assert.match(
  migration,
  /session_line_group_category_retention_state/,
);

assert.match(
  migration,
  /CATEGORY_RETENTION/,
);

assert.match(
  migration,
  /c\.category in \('A','B'\)[\s\S]*then 2/,
  "A/B must divide the two-digit Risk Budget into two simultaneous slots",
);

assert.match(
  migration,
  /else c\.max_special_codes/,
  "E/F/G/H/L must use their configured maximum simultaneous code count",
);

assert.match(
  migration,
  /floor\([\s\S]*b\.risk_budget[\s\S]*c\.effective_multiplier/,
  "retention limits must be derived from Risk Budget and effective multiplier",
);

assert.match(
  migration,
  /recommended_cut/,
);

assert.match(
  migration,
  /WAITING_FIRST_BAND/,
);

assert.match(
  migration,
  /UNCONFIGURED/,
);

assert.match(
  migration,
  /DISABLED/,
);

assert.doesNotMatch(
  migration,
  /settlement_transfer_batch_items/,
  "read-only policy must not consume legacy transfer attribution",
);

assert.doesNotMatch(
  migration,
  /point_loss_tolerance/,
  "new model must remain independent of legacy tolerance",
);

console.log(
  "PASS: LINE Group category retention policy v8.9.3",
);
