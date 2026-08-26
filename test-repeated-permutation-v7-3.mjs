import assert from "node:assert/strict";
import { parseOrder, PARSER_VERSION } from "./src/lib/order-parser.mjs";

function itemMap(result) {
  return Object.fromEntries(result.items.map((x) => [`${x.category}${x.code}`, x.quantity]));
}
function total(result) {
  return result.items.reduce((sum, x) => sum + Number(x.quantity || 0), 0);
}

assert.ok(PARSER_VERSION.startsWith("1."));

const threeDoor = parseOrder("998=100x100x100");
assert.equal(threeDoor.status, "PARSED");
assert.equal(threeDoor.items.length, 3);
assert.equal(total(threeDoor), 300);
assert.deepEqual(itemMap(threeDoor), { E899: 100, E989: 100, E998: 100 });
assert.ok(threeDoor.rule_ids.includes("R_3DIGIT_REPEATED_PERMUTATION"));

for (const text of ["998=100 ทุกกลับ", "998=100 3ปต", "998=100 3ประตู"]) {
  const result = parseOrder(text);
  assert.equal(result.status, "PARSED", text);
  assert.deepEqual(itemMap(result), itemMap(threeDoor), text);
}

const sixDoor = parseOrder("093=100x100x100x100x100x100");
assert.equal(sixDoor.status, "PARSED");
assert.equal(sixDoor.items.length, 6);
assert.equal(total(sixDoor), 600);
for (const code of ["093", "039", "903", "930", "309", "390"]) {
  assert.equal(itemMap(sixDoor)[`E${code}`], 100);
}

assert.equal(total(parseOrder("998=100x3")), 300);
assert.equal(total(parseOrder("093=100x6")), 600);

const efPair = parseOrder("998=100x100");
assert.equal(efPair.status, "PARSED");
assert.deepEqual(itemMap(efPair), { E998: 100, F998: 100 });
assert.equal(total(efPair), 200);

const multiEfPair = parseOrder("920,202,707,101=500x500");
assert.equal(multiEfPair.status, "PARSED");
assert.equal(multiEfPair.items.length, 8);
assert.equal(total(multiEfPair), 4000);

const badCount = parseOrder("998=100x100x100x100");
assert.equal(badCount.status, "REVIEW");
assert.ok(badCount.errors.some((x) => x.code === "PERMUTATION_COUNT_MISMATCH"));

const unequal = parseOrder("998=100x200x100");
assert.equal(unequal.status, "REVIEW");
assert.ok(unequal.errors.some((x) => x.code === "REPEATED_PERMUTATION_QUANTITY_MISMATCH"));

const oldWrongForm = parseOrder("998=100x100x*100");
assert.equal(oldWrongForm.status, "REVIEW");
assert.ok(oldWrongForm.errors.some((x) => x.code === "INVALID_XSTAR_PERMUTATION"));

console.log("PASS: corrected repeated-quantity permutation grammar v7.3 smoke tests");
