import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

function canonical(result) {
  return [...result.items]
    .map((item) => `${item.category}${item.code}=${item.quantity}`)
    .sort();
}

{
  const result = parseOrder(`778
100*100`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "E778=100",
      "F778=100",
    ].sort()
  );

  console.log("PASS MIXED-01 3-digit pending code + pair");
}

{
  const result = parseOrder(`78
87
1000*1000
778
100*100
ต่าย🇱🇦`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "A78=1000",
      "A87=1000",
      "B78=1000",
      "B87=1000",
      "E778=100",
      "F778=100",
    ].sort()
  );

  console.log("PASS MIXED-02 2-digit then 3-digit blocks");
}

console.log("PASS: mixed-width multiline contract v9.1");
