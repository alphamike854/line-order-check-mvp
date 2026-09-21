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


// ------------------------------------------------------------
// P2J-01
// Repeated equal quantities are permutation shorthand.
// ------------------------------------------------------------

for (const text of [
  "229=50*50*50",
  "229=50x50x50",
  "229=50×50×50",
]) {
  const result =
    parseOrder(text);

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

  assert.ok(
    result.rule_ids.includes(
      "R_3DIGIT_REPEATED_PERMUTATION"
    ),
    text
  );
}


{
  const result =
    parseOrder(
      "122=50*50*50"
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "E122=50",
      "E212=50",
      "E221=50",
    ].sort()
  );
}


{
  const result =
    parseOrder(
      "229=50*40*50"
    );

  assert.equal(
    result.status,
    "REVIEW"
  );

  assert.ok(
    result.errors.some(
      error =>
        error.code ===
          "REPEATED_PERMUTATION_QUANTITY_MISMATCH"
    )
  );
}


{
  const result =
    parseOrder(
      "123=50*50*50"
    );

  assert.equal(
    result.status,
    "REVIEW"
  );

  assert.ok(
    result.errors.some(
      error =>
        error.code ===
          "PERMUTATION_COUNT_MISMATCH"
    )
  );
}

console.log(
  "PASS P2J-01 repeated-quantity permutation contract"
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
// Historical production message now fully parses because the
// repeated 229 expression is confirmed permutation shorthand.
{
  const result =
    parseOrder(
      `229=50*50*50

29=100*100
92=100*100`
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "A29=100",
      "A92=100",
      "B29=100",
      "B92=100",
      "E229=50",
      "E292=50",
      "E922=50",
    ].sort()
  );

  assert.equal(
    result.errors.length,
    0
  );

  console.log(
    "PASS P2J-03 production repeated permutation"
  );
}


console.log(
  "PASS: production parser P2J explicit permutation contract v9.12"
);
