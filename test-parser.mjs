import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";
import { calculateAllocation } from "./src/lib/allocation-engine.mjs";
import { cleanOcrText, hasOcrUncertainty } from "./src/lib/image-ocr.mjs";

function itemMap(result) {
  return Object.fromEntries(result.items.map((x) => [`${x.category}${x.code}`, x.quantity]));
}

assert.deepEqual(itemMap(parseOrder("01=20")), { A01: 20 });
assert.deepEqual(itemMap(parseOrder("AB\n01\n02\n03=20")), {
  A01:20,A02:20,A03:20,B01:20,B02:20,B03:20
});
assert.equal(parseOrder("123=20x4").status, "REVIEW");
assert.equal(calculateAllocation(210, 100, 0).shouldTransfer, 100);
assert.equal(calculateAllocation(320, 100, 100).transferNow, 100);

assert.equal(cleanOcrText("```text\nAB\n01\n02=20\n```"), "AB\n01\n02=20");
assert.equal(hasOcrUncertainty("AB\n01=20"), false);
assert.equal(hasOcrUncertainty("AB\n0?=20"), true);

console.log("PASS: Parser + Allocation + OCR helper smoke tests");
