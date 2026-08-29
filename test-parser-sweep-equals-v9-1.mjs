import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

function canonical(result) {
  return [...result.items]
    .map(
      (item) =>
        `${item.category}${item.code}=${item.quantity}`,
    )
    .sort();
}

{
  const result =
    parseOrder("รูด6=300*300");

  assert.equal(
    result.status,
    "PARSED",
    "supported รูด pair must not be downgraded to PARTIAL",
  );

  const expected = [];

  for (let n = 60; n <= 69; n += 1) {
    expected.push(`A${n}=300`);
    expected.push(`B${n}=300`);
  }

  assert.deepEqual(
    canonical(result),
    expected.sort(),
  );

  assert.deepEqual(
    result.errors,
    [],
  );

  console.log(
    "PASS SWEEP-01 รูด6=300*300 remains fully PARSED",
  );
}

console.log(
  "PASS: sweep equals regression v9.1",
);
