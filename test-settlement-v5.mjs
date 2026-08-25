import assert from "node:assert/strict";
import { reducedQuantity, reconciliationTotal, specialPointForQuantity, thresholdProgress } from "./src/lib/settlement-calculations.mjs";

assert.equal(reducedQuantity(500, 5), 475);
assert.equal(specialPointForQuantity(10, 20), 200);
assert.equal(reconciliationTotal(500, 5, 200), 275);
assert.deepEqual(thresholdProgress(410, 200), { full_segments: 2, remainder: 10, remainder_pct: 5 });
assert.equal(reconciliationTotal(300, 1, 60), 237);
console.log("PASS: Settlement + Point + Reduction v5 smoke tests");
