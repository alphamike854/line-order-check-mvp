import assert from "node:assert/strict";
import { buildRiskDistributionPlan } from "./src/lib/risk-engine.mjs";

// Re-ranking must remain unit-by-unit. With one special A code allowed,
// equal exposures alternate as each currently selected code is reduced.
const rerank = buildRiskDistributionPlan({
  rows: [
    { category: "A", code: "01", retained_quantity: 100, effective_multiplier: 14, max_special_codes: 1 },
    { category: "A", code: "02", retained_quantity: 100, effective_multiplier: 14, max_special_codes: 1 },
  ],
  adjustedTotal: 1260,
  pointLossTolerance: 0,
  maxSimulationUnits: 1000,
});

assert.equal(rerank.point_reserve_before, 1400);
assert.equal(rerank.point_reserve_after_plan, 1260);
assert.equal(rerank.transfer_required_total, 20);
const rerankByCode = new Map(rerank.recommendations.map((row) => [row.code, row]));
assert.equal(rerankByCode.get("01")?.recommended_transfer, 10);
assert.equal(rerankByCode.get("02")?.recommended_transfer, 10);
assert.equal(rerankByCode.get("01")?.projected_retained, 90);
assert.equal(rerankByCode.get("02")?.projected_retained, 90);

// Cross-category scoring must still prefer the candidate that reduces reserve most.
const crossCategory = buildRiskDistributionPlan({
  rows: [
    { category: "A", code: "01", retained_quantity: 100, effective_multiplier: 14, max_special_codes: 1 },
    { category: "E", code: "123", retained_quantity: 20, effective_multiplier: 100, max_special_codes: 1 },
  ],
  adjustedTotal: 3300,
  pointLossTolerance: 0,
  maxSimulationUnits: 1000,
});
assert.equal(crossCategory.point_reserve_before, 3400);
assert.equal(crossCategory.point_reserve_after_plan, 3300);
assert.equal(crossCategory.transfer_required_total, 1);
assert.equal(crossCategory.recommendations[0]?.category, "E");
assert.equal(crossCategory.recommendations[0]?.code, "123");
assert.equal(crossCategory.recommendations[0]?.recommended_transfer, 1);

console.log("PASS: risk distribution cached category re-ranking");
