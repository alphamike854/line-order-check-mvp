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

const expected229 = [
  "E229=50",
  "E292=50",
  "E922=50",
].sort();

const expected122 = [
  "E122=50",
  "E212=50",
  "E221=50",
].sort();

// ------------------------------------------------------------
// P2J-01
// Production repeated-* shorthand.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "229=50*50*50"
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 3);
  assert.equal(total(result), 150);

  assert.deepEqual(
    canonical(result),
    expected229
  );

  assert.equal(
    result.rule_ids.includes(
      "R_3DIGIT_REPEATED_PERMUTATION"
    ),
    true
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);

  console.log(
    "PASS P2J-01 repeated star permutation"
  );
}

// ------------------------------------------------------------
// P2J-02
// Another 3-permutation code.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "122=50*50*50"
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 3);
  assert.equal(total(result), 150);

  assert.deepEqual(
    canonical(result),
    expected122
  );

  console.log(
    "PASS P2J-02 repeated star 122"
  );
}

// ------------------------------------------------------------
// P2J-03
// 3กลับ is an explicit synonym for 3 permutations.
// ------------------------------------------------------------
for (const text of [
  "229=50 3กลับ",
  "229=50 3 กลับ",
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

  assert.equal(
    total(result),
    150,
    text
  );

  assert.deepEqual(
    canonical(result),
    expected229,
    text
  );
}

console.log(
  "PASS P2J-03 3กลับ aliases"
);

// ------------------------------------------------------------
// P2J-SAFETY-01
// Existing x spelling remains identical.
// ------------------------------------------------------------
for (const text of [
  "229=50x50x50",
  "229=50×50×50",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    text
  );

  assert.deepEqual(
    canonical(result),
    expected229,
    text
  );
}

console.log(
  "PASS P2J-SAFETY-01 x variants unchanged"
);

// ------------------------------------------------------------
// P2J-SAFETY-02
// Existing explicit permutation spellings remain identical.
// ------------------------------------------------------------
for (const text of [
  "229=50*3ก",
  "229=50 3ประตู",
  "229=50 3ปต",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    text
  );

  assert.deepEqual(
    canonical(result),
    expected229,
    text
  );
}

console.log(
  "PASS P2J-SAFETY-02 explicit aliases unchanged"
);

// ------------------------------------------------------------
// P2J-SAFETY-03
// Unequal repeated quantities remain invalid.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "229=50*40*50"
  );

  assert.equal(result.status, "REVIEW");
  assert.equal(result.items.length, 0);

  assert.equal(
    result.errors.some(
      x =>
        x.code ===
        "REPEATED_PERMUTATION_QUANTITY_MISMATCH"
    ),
    true
  );

  console.log(
    "PASS P2J-SAFETY-03 unequal quantities rejected"
  );
}

// ------------------------------------------------------------
// P2J-SAFETY-04
// Number of repeated values must match unique permutations.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "123=50*50*50"
  );

  assert.equal(result.status, "REVIEW");
  assert.equal(result.items.length, 0);

  assert.equal(
    result.errors.some(
      x =>
        x.code ===
        "PERMUTATION_COUNT_MISMATCH"
    ),
    true
  );

  console.log(
    "PASS P2J-SAFETY-04 permutation count validated"
  );
}

// ------------------------------------------------------------
// P2J-SAFETY-05
// "3กลับ" carries an explicit count of three. A code with six
// unique permutations must therefore remain REVIEW.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "123=50 3กลับ"
  );

  assert.equal(result.status, "REVIEW");
  assert.equal(result.items.length, 0);

  assert.equal(
    result.errors.some(
      x =>
        x.code ===
        "PERMUTATION_COUNT_MISMATCH"
    ),
    true
  );

  console.log(
    "PASS P2J-SAFETY-05 3กลับ count validated"
  );
}

// ------------------------------------------------------------
// P2J-04
// Exact formerly unresolved production message.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `229=50*50*50

29=100*100
92=100*100`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 7);
  assert.equal(total(result), 550);

  assert.deepEqual(
    canonical(result),
    [
      "A29=100",
      "A92=100",
      "B29=100",
      "B92=100",
      ...expected229,
    ].sort()
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);

  console.log(
    "PASS P2J-04 full production message"
  );
}

console.log(
  "PASS: production parser P2J repeated permutation regression v9.12"
);
