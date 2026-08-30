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

const lowerBlock = `15
51
18
81
58
85-20*20 บล`;

const expectedLower = [
  "A15=20",
  "A18=20",
  "A51=20",
  "A58=20",
  "A81=20",
  "A85=20",
  "B15=20",
  "B18=20",
  "B51=20",
  "B58=20",
  "B81=20",
  "B85=20",
].sort();

// ------------------------------------------------------------
// P2D-01
// Production multiline 2-digit pair block.
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
    240
  );

  assert.deepEqual(
    canonical(result),
    expectedLower
  );

  assert.equal(
    result.errors.length,
    0
  );

  console.log(
    "PASS P2D-01 multiline 2-digit terminal pair"
  );
}

// ------------------------------------------------------------
// P2D-02
// Full production mixed-width message.
// 158 remains E/F and lower block becomes A/B.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `บน
158 20*20

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
    280
  );

  assert.deepEqual(
    canonical(result),
    [
      ...expectedLower,
      "E158=20",
      "F158=20",
    ].sort()
  );

  assert.equal(
    result.errors.length,
    0
  );

  console.log(
    "PASS P2D-02 mixed 3-digit and 2-digit blocks"
  );
}

// ------------------------------------------------------------
// P2D-SAFETY-01
// Existing explicit normalized form is the semantic baseline.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "15 51 18 81 58 85=20*20 บล"
  );

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
    240
  );

  assert.deepEqual(
    canonical(result),
    expectedLower
  );

  console.log(
    "PASS P2D-SAFETY-01 explicit baseline unchanged"
  );
}

// ------------------------------------------------------------
// P2D-SAFETY-02
// A standalone dash-pair line does not get generalized by P2D.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "85-20*20 บล"
  );

  assert.notEqual(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    0
  );

  console.log(
    "PASS P2D-SAFETY-02 standalone dash pair remains safe"
  );
}

// ------------------------------------------------------------
// P2D-SAFETY-03
// Existing no-modifier pair grammar remains A/B by default.
// P2D must not disturb this already-supported behavior.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `15
51
18
81
58
85-20*20`
  );

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
    240
  );

  assert.deepEqual(
    canonical(result),
    expectedLower
  );

  assert.equal(
    result.errors.length,
    0
  );

  console.log(
    "PASS P2D-SAFETY-03 no-modifier pair remains A/B"
  );
}

// ------------------------------------------------------------
// P2D-SAFETY-04
// Reverse modifier is deliberately outside this phase.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `15
51
18
81
58
85-20*20 บลก`
  );

  assert.notEqual(
    result.status,
    "PARSED"
  );

  console.log(
    "PASS P2D-SAFETY-04 บลก remains outside P2D"
  );
}

console.log(
  "PASS: production parser P2D regression v9.7"
);
