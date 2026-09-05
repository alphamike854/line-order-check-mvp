import assert from "node:assert/strict";

import {
  parseOrder
} from "./src/lib/order-parser.mjs";

function canonical(result) {
  return [...(result.items || [])]
    .map(
      (item) =>
        `${item.category}${item.code}=${Number(
          item.quantity
        )}`
    )
    .sort();
}


// ------------------------------------------------------------
// PA-01
//
// Confirmed production false positive:
//
//   82,635-35%=53,712
//
// This is arithmetic/report text, not an order.
// It must never create order items.
// ------------------------------------------------------------

{
  const result =
    parseOrder("82,635-35%=53,712");

  assert.equal(
    result.status,
    "IGNORE",
    `expected IGNORE, got ${result.status}`
  );

  assert.deepEqual(
    result.items,
    [],
    "percent arithmetic must not create order items"
  );

  assert.deepEqual(
    result.errors,
    [],
    "plain percent arithmetic should not enter Review"
  );

  console.log(
    "PASS PA-01 confirmed production percent arithmetic"
  );
}


// ------------------------------------------------------------
// PA-02
// Thousands separators.
// ------------------------------------------------------------

{
  const result =
    parseOrder("100,000-40%=60,000");

  assert.equal(result.status, "IGNORE");
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.errors, []);

  console.log(
    "PASS PA-02 thousands-separated arithmetic"
  );
}


// ------------------------------------------------------------
// PA-03
// Natural whitespace.
// ------------------------------------------------------------

{
  const result =
    parseOrder(
      "25,000 - 10% = 22,500"
    );

  assert.equal(result.status, "IGNORE");
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.errors, []);

  console.log(
    "PASS PA-03 spaced percent arithmetic"
  );
}


// ------------------------------------------------------------
// PA-04
//
// Arithmetic summary after a real order must be ignored
// WITHOUT discarding the valid order.
// ------------------------------------------------------------

{
  const result =
    parseOrder(
      `01=20
82,635-35%=53,712`
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    ["A01=20"]
  );

  assert.deepEqual(
    result.errors,
    []
  );

  console.log(
    "PASS PA-04 arithmetic line after real order"
  );
}


// ------------------------------------------------------------
// PA-05
//
// Ordinary dash/equal order grammar must remain untouched.
// ------------------------------------------------------------

{
  const cases = [
    [
      "35=500",
      ["A35=500"]
    ],
    [
      "82=300",
      ["A82=300"]
    ],
    [
      "35 82=500",
      ["A35=500", "A82=500"]
    ],
  ];

  for (const [text, expected] of cases) {
    const result = parseOrder(text);

    assert.equal(
      result.status,
      "PARSED",
      `must remain PARSED: ${text}`
    );

    assert.deepEqual(
      canonical(result),
      expected.sort(),
      `canonical mismatch: ${text}`
    );
  }

  console.log(
    "PASS PA-05 ordinary order assignments unchanged"
  );
}


console.log(
  "PASS: percent arithmetic parser safety v9.24"
);
