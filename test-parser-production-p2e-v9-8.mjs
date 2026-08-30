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
// P2E-SAFETY-01
// Standalone 3-digit dash pair remains unsupported.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "587-100*100"
  );

  assert.equal(
    result.status,
    "REVIEW"
  );

  assert.equal(
    result.items.length,
    0
  );

  console.log(
    "PASS P2E-SAFETY-01 standalone remains REVIEW"
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
// A single following code is not enough contextual evidence.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `587-100*100

78
85=100 บลก`
  );

  const items = canonical(result);

  assert.equal(
    items.includes("E587=100"),
    false
  );

  assert.equal(
    items.includes("F587=100"),
    false
  );

  console.log(
    "PASS P2E-SAFETY-04 requires at least two following codes"
  );
}

// ------------------------------------------------------------
// P2E-SAFETY-05
// Missing explicit terminal modifier cannot recover first line.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `587-100*100

78
75
85=100`
  );

  const items = canonical(result);

  assert.equal(
    items.includes("E587=100"),
    false
  );

  assert.equal(
    items.includes("F587=100"),
    false
  );

  console.log(
    "PASS P2E-SAFETY-05 modifier remains required"
  );
}

console.log(
  "PASS: production parser P2E compatibility regression v9.8"
);
