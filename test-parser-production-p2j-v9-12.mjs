import assert from "node:assert/strict";

import {
  parseOrder,
} from "./src/lib/order-parser.mjs";


function canonical(result) {
  return (result.items || [])
    .map(
      (item) =>
        `${item.category}${item.code}=${Number(item.quantity)}`
    )
    .sort();
}


const expected229 = [
  "E229=50",
  "E292=50",
  "E922=50",
].sort();


function expectUnmarkedReview(text) {
  const result =
    parseOrder(text);

  assert.equal(
    result.status,
    "REVIEW",
    text,
  );

  assert.equal(
    result.items.length,
    0,
    text,
  );

  assert.ok(
    result.errors.some(
      (error) =>
        error.code ===
        "UNSUPPORTED_QUANTITY_EXPRESSION"
    ),
    text,
  );

  assert.ok(
    result.rule_ids.includes(
      "R_3DIGIT_UNMARKED_QUANTITY_CHAIN"
    ),
    text,
  );
}


// ------------------------------------------------------------
// P2J-01
// Historical repeated-* shorthand is no longer permutation.
// ------------------------------------------------------------
for (const text of [
  "229=50*50*50",
  "122=50*50*50",
  "229=50x50x50",
  "229=50×50×50",
  "229=50*40*50",
  "123=50*50*50",
]) {
  expectUnmarkedReview(text);
}

console.log(
  "PASS P2J-01 unmarked quantity chains fail closed"
);


// ------------------------------------------------------------
// P2J-02
// Explicit permutation vocabulary remains supported.
// ------------------------------------------------------------
for (const text of [
  "229=50 3กลับ",
  "229=50 3 กลับ",
  "229=50*3ก",
  "229=50 3ประตู",
  "229=50 3ปต",
]) {
  const result =
    parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    text,
  );

  assert.deepEqual(
    canonical(result),
    expected229,
    text,
  );
}

console.log(
  "PASS P2J-02 explicit permutation aliases unchanged"
);


// ------------------------------------------------------------
// P2J-SAFETY-01
// Explicit count still validates unique permutations.
// 123 has six unique permutations, therefore 3กลับ is invalid.
// ------------------------------------------------------------
{
  const result =
    parseOrder(
      "123=50 3กลับ"
    );

  assert.equal(
    result.status,
    "REVIEW"
  );

  assert.equal(
    result.items.length,
    0
  );

  assert.ok(
    result.errors.some(
      (error) =>
        error.code ===
        "PERMUTATION_COUNT_MISMATCH"
    )
  );
}

console.log(
  "PASS P2J-SAFETY-01 explicit permutation count validated"
);


// ------------------------------------------------------------
// P2J-03
// Exact historical production message:
// valid two-digit pairs remain canonical,
// unmarked 3-value chain causes PARTIAL.
// ------------------------------------------------------------
{
  const result =
    parseOrder(
      `229=50*50*50

29=100*100
92=100*100`
    );

  assert.equal(
    result.status,
    "PARTIAL"
  );

  assert.deepEqual(
    canonical(result),
    [
      "A29=100",
      "A92=100",
      "B29=100",
      "B92=100",
    ].sort()
  );

  assert.ok(
    result.errors.some(
      (error) =>
        error.code ===
        "UNSUPPORTED_QUANTITY_EXPRESSION"
    )
  );

  console.log(
    "PASS P2J-03 production message keeps valid items and reviews unmarked chain"
  );
}


console.log(
  "PASS: production parser P2J explicit permutation contract v9.12"
);
