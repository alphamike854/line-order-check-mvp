import assert from "node:assert/strict";
import {
  parseOrder,
} from "./src/lib/order-parser.mjs";

function canonical(result) {
  return (result.items || [])
    .map(
      (x) =>
        `${x.category}${x.code}=${Number(x.quantity)}`
    )
    .sort();
}

function total(result) {
  return (result.items || []).reduce(
    (sum, x) =>
      sum + Number(x.quantity || 0),
    0
  );
}

const lowerBlock = `78
75
85-100 บลก`;

const expectedLower = [
  "A57=100",
  "A58=100",
  "A75=100",
  "A78=100",
  "A85=100",
  "A87=100",
  "B57=100",
  "B58=100",
  "B75=100",
  "B78=100",
  "B85=100",
  "B87=100",
].sort();

// ------------------------------------------------------------
// P2E-01
// Exact production case.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `587-100*100

${lowerBlock}`
  );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    14
  );

  assert.equal(
    total(result),
    1400
  );

  assert.deepEqual(
    canonical(result),
    [
      ...expectedLower,
      "E587=100",
      "F587=100",
    ].sort()
  );

  assert.equal(
    result.errors.length,
    0
  );

  assert.equal(
    result.warnings.length,
    0
  );

  console.log(
    "PASS P2E-01 production contextual 3-digit dash pair"
  );
}

// ------------------------------------------------------------
// P2K contract:
// standalone 3-digit dash pair is a canonical E/F assignment.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "587-100*100"
  );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "E587=100",
      "F587=100",
    ]
  );

  console.log(
    "PASS P2E-SAFETY-01 standalone uses E/F"
  );
}

// ------------------------------------------------------------
// P2E-SAFETY-02
// Lower 2-digit block remains unchanged.
// ------------------------------------------------------------
{
  const result = parseOrder(lowerBlock);

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    12
  );

  assert.equal(
    total(result),
    1200
  );

  assert.deepEqual(
    canonical(result),
    expectedLower
  );

  console.log(
    "PASS P2E-SAFETY-02 lower block unchanged"
  );
}

// ------------------------------------------------------------
// P2E-SAFETY-03
// Explicit canonical terminal is valid evidence as well.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `587-100*100

78
75
85=100 บลก`
  );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    14
  );

  assert.equal(
    total(result),
    1400
  );

  assert.deepEqual(
    canonical(result),
    [
      ...expectedLower,
      "E587=100",
      "F587=100",
    ].sort()
  );

  console.log(
    "PASS P2E-SAFETY-03 canonical terminal evidence supported"
  );
}

// ------------------------------------------------------------
// P2E-SAFETY-04
// Standalone E/F assignment remains isolated from a following
// single-code บลก block. No quantity leakage is allowed.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `587-100*100

78
85=100 บลก`
  );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    10
  );

  assert.equal(
    total(result),
    1000
  );

  assert.deepEqual(
    canonical(result),
    [
      "A58=100",
      "A78=100",
      "A85=100",
      "A87=100",
      "B58=100",
      "B78=100",
      "B85=100",
      "B87=100",
      "E587=100",
      "F587=100",
    ]
  );

  console.log(
    "PASS P2E-SAFETY-04 standalone E/F isolated from บลก block"
  );
}

// ------------------------------------------------------------
// P2E-SAFETY-05
// Standalone E/F assignment remains isolated from a following
// ordinary 2-digit block without a reverse modifier.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `587-100*100

78
75
85=100`
  );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    5
  );

  assert.equal(
    total(result),
    500
  );

  assert.deepEqual(
    canonical(result),
    [
      "A75=100",
      "A78=100",
      "A85=100",
      "E587=100",
      "F587=100",
    ]
  );

  assert.equal(
    canonical(result).some(
      (item) =>
        item.startsWith("B75=") ||
        item.startsWith("B78=") ||
        item.startsWith("B85=")
    ),
    false
  );

  console.log(
    "PASS P2E-SAFETY-05 ordinary lower block remains isolated"
  );
}

console.log(
  "PASS: production parser P2E compatibility regression v9.8"
);
