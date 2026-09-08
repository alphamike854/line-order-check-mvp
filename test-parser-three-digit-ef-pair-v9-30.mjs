import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

function canonical(result) {
  return (result.items || [])
    .map(
      (item) =>
        `${item.category}${item.code}=${Number(item.quantity)}`
    )
    .sort();
}

function assertParsed(
  text,
  expected,
) {
  const result =
    parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    text,
  );

  assert.deepEqual(
    canonical(result),
    [...expected].sort(),
    text,
  );

  assert.equal(
    result.errors.length,
    0,
    text,
  );

  return result;
}

assert.equal(
  PARSER_VERSION,
  "1.7.23",
);


// ------------------------------------------------------------
// EF-01 / EF-02 / EF-03
// '=' with x / * / ×
// ------------------------------------------------------------
for (const text of [
  "123=5x5",
  "123=5*5",
  "123=5×5",
]) {
  assertParsed(
    text,
    [
      "E123=5",
      "F123=5",
    ],
  );
}

console.log(
  "PASS EF-01: 123=5 pair is E/F"
);


// ------------------------------------------------------------
// EF-04
// 3 and 6 have no permutation meaning without marker.
// ------------------------------------------------------------
assertParsed(
  "123=20x3",
  [
    "E123=20",
    "F123=3",
  ],
);

assertParsed(
  "123=20x6",
  [
    "E123=20",
    "F123=6",
  ],
);

console.log(
  "PASS EF-02: x3/x6 without marker are E/F"
);


// ------------------------------------------------------------
// EF-05 natural-space spelling
// ------------------------------------------------------------
assertParsed(
  "123 5*5",
  [
    "E123=5",
    "F123=5",
  ],
);

assertParsed(
  "123 20*3",
  [
    "E123=20",
    "F123=3",
  ],
);

assertParsed(
  "123 20*6",
  [
    "E123=20",
    "F123=6",
  ],
);

console.log(
  "PASS EF-03: natural-space pair is E/F"
);


// ------------------------------------------------------------
// PERM-01
// Explicit ก remains counted permutation.
// ------------------------------------------------------------
{
  const result =
    parseOrder(
      "123=20x6 ก",
    );

  assert.equal(
    result.status,
    "PARSED",
  );

  assert.deepEqual(
    canonical(result),
    [
      "E123=20",
      "E132=20",
      "E213=20",
      "E231=20",
      "E312=20",
      "E321=20",
    ].sort(),
  );

  assert.ok(
    result.rule_ids.includes(
      "R_3DIGIT_COUNTED_PERMUTE",
    ),
  );
}

console.log(
  "PASS PERM-01: explicit x6 ก remains permutation"
);


// ------------------------------------------------------------
// PERM-02
// Repeated digit code has 3 unique permutations.
// ------------------------------------------------------------
{
  const result =
    parseOrder(
      "122=20x3 ก",
    );

  assert.equal(
    result.status,
    "PARSED",
  );

  assert.deepEqual(
    canonical(result),
    [
      "E122=20",
      "E212=20",
      "E221=20",
    ].sort(),
  );
}

console.log(
  "PASS PERM-02: explicit x3 ก remains permutation"
);


// ------------------------------------------------------------
// PERM-SAFETY-01
// Count must still equal unique permutations.
// ------------------------------------------------------------
{
  const result =
    parseOrder(
      "122=20x6 ก",
    );

  assert.equal(
    result.status,
    "REVIEW",
  );

  assert.equal(
    result.items.length,
    0,
  );

  assert.ok(
    result.errors.some(
      (error) =>
        error.code
        === "PERMUTATION_COUNT_MISMATCH",
    ),
  );
}

console.log(
  "PASS PERM-SAFETY-01: explicit permutation count still validated"
);


// ------------------------------------------------------------
// Existing multi-code E/F pair remains unchanged.
// ------------------------------------------------------------
assertParsed(
  "920,202,707,101=500x500",
  [
    "E920=500",
    "F920=500",
    "E202=500",
    "F202=500",
    "E707=500",
    "F707=500",
    "E101=500",
    "F101=500",
  ],
);

console.log(
  "PASS EF-SAFETY-01: multi-code E/F remains unchanged"
);


// ------------------------------------------------------------
// CHAIN-SAFETY-01
// 3+ values without explicit permutation vocabulary
// must fail closed.
// ------------------------------------------------------------
for (const text of [
  "123=5x5x5",
  "229=50*50*50",
  "998=100×100×100",
]) {
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
        "UNSUPPORTED_QUANTITY_EXPRESSION",
    ),
    text,
  );

  assert.ok(
    result.rule_ids.includes(
      "R_3DIGIT_UNMARKED_QUANTITY_CHAIN",
    ),
    text,
  );
}

console.log(
  "PASS CHAIN-SAFETY-01: unmarked 3+ quantity chains fail closed"
);


// ------------------------------------------------------------
// Explicit marker vocabulary must remain authoritative.
// ------------------------------------------------------------
for (const text of [
  "229=50*3ก",
  "229=50 3กลับ",
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
    [
      "E229=50",
      "E292=50",
      "E922=50",
    ].sort(),
    text,
  );
}

{
  const result =
    parseOrder(
      "998=100 ทุกกลับ",
    );

  assert.equal(
    result.status,
    "PARSED",
  );

  assert.deepEqual(
    canonical(result),
    [
      "E899=100",
      "E989=100",
      "E998=100",
    ].sort(),
  );
}

console.log(
  "PASS CHAIN-SAFETY-02: explicit permutation vocabulary remains authoritative"
);


console.log(
  "PASS: explicit-marker permutation + 3-digit E/F pair v9.30"
);
