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

const expectedUpper = [
  "E688=50",
  "E788=50",
  "E868=50",
  "E878=50",
  "E886=50",
  "E887=50",
  "E889=50",
  "E898=50",
  "E988=50",
].sort();

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

// ------------------------------------------------------------
// P2C-01 / updated by P2H semantic evidence.
// Multiline 3ก is now safely recoverable.
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
    "PARSED"
  );

  assert.equal(
    result.items.length,
    9
  );

  assert.equal(
    total(result),
    450
  );

  assert.deepEqual(
    canonical(result),
    expectedUpper
  );

  assert.equal(
    result.rule_ids.includes(
      "R_3DIGIT_COUNTED_PERMUTE"
    ),
    true
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);

  console.log(
    "PASS P2C-01 multiline 3ก safely recovered"
  );
}

// ------------------------------------------------------------
// P2C-SAFETY-01
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
// Recovered 3ก quantity must remain isolated from lower block.
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
    "PARSED"
  );

  assert.equal(
    result.items.length,
    29
  );

  assert.equal(
    total(result),
    1450
  );

  assert.deepEqual(
    canonical(result),
    [
      ...expectedUpper,
      ...expectedLower,
    ].sort()
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

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);

  console.log(
    "PASS P2C-02 multiline 3ก cannot contaminate 2-digit block"
  );
}

// ------------------------------------------------------------
// P2C-SAFETY-02
// Existing inline counted-permutation grammar is unchanged.
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
