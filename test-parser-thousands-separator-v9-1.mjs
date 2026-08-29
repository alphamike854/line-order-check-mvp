import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

function canonical(result) {
  return [...result.items]
    .map((item) => `${item.category}${item.code}=${item.quantity}`)
    .sort();
}

{
  const result = parseOrder(`15=1,000x1,000
51=100x100
4ตัว
ทับทิม2200`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "A15=1000",
      "A51=100",
      "B15=1000",
      "B51=100",
    ].sort()
  );

  assert.equal(
    result.items.reduce((sum, item) => sum + item.quantity, 0),
    2200
  );

  console.log("PASS COMMA-01 inline thousands separator");
}

{
  const result = parseOrder(`78
87
1,000*1,000
ต่าย🇱🇦`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "A78=1000",
      "A87=1000",
      "B78=1000",
      "B87=1000",
    ].sort()
  );

  assert.equal(
    result.items.reduce((sum, item) => sum + item.quantity, 0),
    4000
  );

  console.log("PASS COMMA-02 multiline thousands separator");
}

{
  const result = parseOrder("90/09=1000*1000");

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "A09=1000",
      "A90=1000",
      "B09=1000",
      "B90=1000",
    ].sort()
  );

  console.log("PASS COMMA-SAFETY-01 non-comma behavior unchanged");
}

console.log("PASS: thousands-separator parser contract v9.1");
