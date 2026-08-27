import assert from "node:assert/strict";
import { parseOrder, PARSER_VERSION } from "./src/lib/order-parser.mjs";

function total(result, category = null) {
  return result.items
    .filter((item) => !category || item.category === category)
    .reduce((sum, item) => sum + item.quantity, 0);
}

function byKey(result) {
  return new Map(result.items.map((item) => [`${item.category}${item.code}`, item.quantity]));
}

assert.equal(PARSER_VERSION, "1.5.2");

// TOP/BOTTOM are contextual synonyms, not global aliases.
for (const word of ["บน", "บ"]) {
  const r2 = parseOrder(`05 06=20 ${word}`);
  assert.equal(r2.status, "PARSED");
  assert.equal(total(r2, "A"), 40);
  assert.equal(total(r2, "B"), 0);

  const r3 = parseOrder(`503 504=20 ${word}`);
  assert.equal(r3.status, "PARSED");
  assert.equal(total(r3, "E"), 40);
  assert.equal(total(r3, "G"), 0);

  const pair = parseOrder(`503 504=20*30 ${word}`);
  assert.equal(pair.status, "PARSED");
  assert.equal(total(pair, "E"), 40);
  assert.equal(total(pair, "F"), 60);
}

for (const word of ["ล่าง", "ล"]) {
  const r2 = parseOrder(`05 06=20 ${word}`);
  assert.equal(r2.status, "PARSED");
  assert.equal(total(r2, "A"), 0);
  assert.equal(total(r2, "B"), 40);

  const r3 = parseOrder(`503 504=20 ${word}`);
  assert.equal(r3.status, "PARSED");
  assert.equal(total(r3, "G"), 40);
}

// One-digit H/L grammar keeps its longer "วิ่ง..." meaning.
assert.deepEqual(parseOrder("วิ่งบน 1=500").items, [{ category: "H", code: "1", quantity: 500 }]);
assert.deepEqual(parseOrder("วิ่ง บ 1=500").items, [{ category: "H", code: "1", quantity: 500 }]);
assert.deepEqual(parseOrder("วิ่งล่าง 2=300").items, [{ category: "L", code: "2", quantity: 300 }]);
assert.deepEqual(parseOrder("วิ่ง ล 2=300").items, [{ category: "L", code: "2", quantity: 300 }]);

// User regression: both blocks must be parsed. No silent loss of the 3-digit block.
const regression = parseOrder(`05//06//15//16
03//04//13//14
=25 บลก

503//504//513//514
603//604//613//614
=20*30 บน`);
assert.equal(regression.status, "PARSED");
assert.equal(regression.items.length, 48);
assert.equal(total(regression), 1200);
assert.equal(total(regression, "A"), 400);
assert.equal(total(regression, "B"), 400);
assert.equal(total(regression, "E"), 160);
assert.equal(total(regression, "F"), 240);
const keys = byKey(regression);
assert.equal(keys.get("E503"), 20);
assert.equal(keys.get("F503"), 30);
assert.equal(keys.get("E614"), 20);
assert.equal(keys.get("F614"), 30);

// Prefix form is supported too.
assert.equal(total(parseOrder("บน 503 504=20"), "E"), 40);
assert.equal(total(parseOrder("ล่าง 503 504=20"), "G"), 40);
assert.equal(total(parseOrder("บน 05 06=20"), "A"), 40);
assert.equal(total(parseOrder("ล 05 06=20"), "B"), 40);

// Safety: if one order-like block still cannot be parsed, do not silently mark
// the whole message PARSED just because another block succeeded.
const partial = parseOrder(`05=20
999=abc`);
assert.equal(partial.status, "PARTIAL");
assert.ok(partial.errors.some((error) => error.code === "UNRECOGNIZED_ORDER_SYNTAX"));

console.log("PASS: contextual บน/บ + ล่าง/ล across 1/2/3 digits v7.8 smoke tests");
