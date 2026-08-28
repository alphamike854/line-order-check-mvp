import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

function canonical(result) {
  return result.items
    .map(
      (item) =>
        `${item.category}${item.code}=${item.quantity}`
    )
    .sort();
}

{
  const result = parseOrder(`790 = 60 โต๊ด

🇱🇦รวม 60`);

  assert.equal(
    result.status,
    "PARSED",
    "flag-prefixed summary line must not poison a valid order"
  );

  assert.deepEqual(
    canonical(result),
    ["F790=60"]
  );

  assert.equal(result.errors.length, 0);

  console.log(
    "PASS SUMMARY-01 flag-prefixed summary after order"
  );
}

{
  const result = parseOrder(`🇱🇦รวม 60`);

  assert.equal(
    result.status,
    "IGNORE",
    "standalone flag-prefixed summary must be metadata"
  );

  assert.equal(result.items.length, 0);

  console.log(
    "PASS SUMMARY-02 standalone flag-prefixed summary"
  );
}

{
  const result = parseOrder(`🇱🇦รวม 60
01=20`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    ["A01=20"]
  );

  console.log(
    "PASS SUMMARY-03 summary before real order"
  );
}

{
  const result = parseOrder(`🇱🇦ดอม1080
01=20`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    ["A01=20"]
  );

  console.log(
    "PASS SUMMARY-04 unrelated sender text remains harmless"
  );
}

console.log(
  "PASS: summary metadata safety v9.0"
);
