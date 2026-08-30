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

// ------------------------------------------------------------
// P2C-01
// Unsupported multiline 3ก must remain Review-safe and emit no
// accidental 2-digit items.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `886
887
889
-50*3ก`
  );

  assert.equal(
    result.status,
    "REVIEW"
  );

  assert.equal(
    result.items.length,
    0
  );

  assert.equal(
    total(result),
    0
  );

  assert.equal(
    result.errors.some(
      (x) =>
        x.code ===
        "UNRECOGNIZED_ORDER_SYNTAX"
    ),
    true
  );

  assert.equal(
    result.warnings.some(
      (x) =>
        x.code ===
        "UNRECOGNIZED_ORDER_LIKE_TEXT" &&
        x.detail === "-50*3ก"
    ),
    true
  );

  console.log(
    "PASS P2C-01 multiline 3ก remains Review-safe"
  );
}

// ------------------------------------------------------------
// P2C-SAFETY-01
// Valid lower 2-digit block establishes the canonical baseline.
// ------------------------------------------------------------
const lowerBlock = `86
87
67-50 บลก

88
66
77
99-50 บล`;

const expectedLower = [
  "A66=50", "A67=50", "A68=50",
  "A76=50", "A77=50", "A78=50",
  "A86=50", "A87=50", "A88=50",
  "A99=50",
  "B66=50", "B67=50", "B68=50",
  "B76=50", "B77=50", "B78=50",
  "B86=50", "B87=50", "B88=50",
  "B99=50",
].sort();

{
  const result = parseOrder(lowerBlock);

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    20
  );

  assert.equal(
    total(result),
    1000
  );

  assert.deepEqual(
    canonical(result),
    expectedLower
  );

  console.log(
    "PASS P2C-SAFETY-01 lower 2-digit block baseline"
  );
}

// ------------------------------------------------------------
// P2C-02
// Unsupported 3ก block must not contaminate the valid lower block.
// Tentative items may exist because the message remains PARTIAL,
// but they must equal the valid lower block exactly.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `886
887
889
-50*3ก

${lowerBlock}`
  );

  assert.equal(
    result.status,
    "PARTIAL"
  );

  assert.equal(
    result.items.length,
    20
  );

  assert.equal(
    total(result),
    1000
  );

  assert.deepEqual(
    canonical(result),
    expectedLower
  );

  for (const leaked of [
    "A05=50",
    "A50=50",
    "B05=50",
    "B50=50",
  ]) {
    assert.equal(
      canonical(result).includes(leaked),
      false,
      leaked
    );
  }

  assert.equal(
    result.errors.some(
      (x) =>
        x.code ===
        "UNRECOGNIZED_ORDER_SYNTAX"
    ),
    true
  );

  console.log(
    "PASS P2C-02 multiline 3ก cannot contaminate 2-digit block"
  );
}

// ------------------------------------------------------------
// P2C-SAFETY-02
// Existing inline counted-permutation grammar is untouched.
// ------------------------------------------------------------
for (const [
  text,
  expected,
] of [
  [
    "848=40*3ก",
    [
      "E488=40",
      "E848=40",
      "E884=40",
    ],
  ],
  [
    "110=20*3ก",
    [
      "E011=20",
      "E101=20",
      "E110=20",
    ],
  ],
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    text
  );

  assert.equal(
    result.items.length,
    3,
    text
  );

  assert.deepEqual(
    canonical(result),
    expected.sort(),
    text
  );

  assert.equal(
    result.rule_ids.includes(
      "R_3DIGIT_COUNTED_PERMUTE"
    ),
    true,
    text
  );
}

console.log(
  "PASS P2C-SAFETY-02 inline 3ก grammar unchanged"
);

console.log(
  "PASS: production parser P2C boundary regression v9.6"
);
