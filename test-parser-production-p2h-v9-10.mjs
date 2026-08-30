import assert from "node:assert/strict";
import {
  parseOrder,
} from "./src/lib/order-parser.mjs";

function canonical(result) {
  return (result.items || [])
    .map(
      x =>
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
// P2H-01 exact unresolved upper block.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `886
887
889
-50*3ก`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 9);
  assert.equal(total(result), 450);

  assert.deepEqual(
    canonical(result),
    expectedUpper
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);

  console.log(
    "PASS P2H-01 multiline counted permutation"
  );
}

// ------------------------------------------------------------
// P2H-02 exact production message.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `886
887
889
-50*3ก

86
87
67-50 บลก

88
66
77
99-50 บล`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 29);
  assert.equal(total(result), 1450);

  assert.deepEqual(
    canonical(result),
    [
      ...expectedUpper,
      ...expectedLower,
    ].sort()
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);

  console.log(
    "PASS P2H-02 full production message"
  );
}

// ------------------------------------------------------------
// P2H-SAFETY-01
// One preceding code remains outside this multiline recovery.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `886
-50*3ก`
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
    "PASS P2H-SAFETY-01 one-code multiline remains safe"
  );
}

// ------------------------------------------------------------
// P2H-SAFETY-02
// Existing compact semantics are unchanged.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "886 887 889=50*3ก"
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 9);
  assert.equal(total(result), 450);

  assert.deepEqual(
    canonical(result),
    expectedUpper
  );

  console.log(
    "PASS P2H-SAFETY-02 compact baseline unchanged"
  );
}

// ------------------------------------------------------------
// P2H-SAFETY-03
// Existing inline semantics remain unchanged.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "886=50*3ก"
  );

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "E688=50",
      "E868=50",
      "E886=50",
    ].sort()
  );

  console.log(
    "PASS P2H-SAFETY-03 inline baseline unchanged"
  );
}

// ------------------------------------------------------------
// P2H-SAFETY-04
// P2G triple quantity must remain unsupported.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "229=50*50*50"
  );

  assert.equal(result.status, "REVIEW");
  assert.equal(result.items.length, 0);

  assert.equal(
    result.errors.some(
      x =>
        x.code ===
        "UNSUPPORTED_QUANTITY_EXPRESSION"
    ),
    true
  );

  console.log(
    "PASS P2H-SAFETY-04 triple quantity remains unsupported"
  );
}

console.log(
  "PASS: production parser P2H multiline 3ก regression v9.10"
);
