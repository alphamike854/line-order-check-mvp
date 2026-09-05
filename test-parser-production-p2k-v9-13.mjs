import assert from "node:assert/strict";
import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";


function canonical(result) {
  return result.items
    .map(
      (item) =>
        `${item.category}${item.code}=${item.quantity}`
    )
    .sort();
}


function total(result) {
  return result.items.reduce(
    (sum, item) =>
      sum + Number(item.quantity || 0),
    0
  );
}


assert.equal(
  PARSER_VERSION,
  "1.7.15"
);


// ============================================================
// P2K-01
// '+' is an explicit TWO-value quantity-pair delimiter.
// ============================================================
{
  const result =
    parseOrder("01=500+500");

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "A01=500",
      "B01=500",
    ]
  );

  assert.equal(
    total(result),
    1000
  );

  console.log(
    "PASS P2K-01 plus quantity pair"
  );
}


// ============================================================
// P2K-02
// Production Review #1287.
//
// บล
// 18
// 86 } 500+500
// 28-8-69
//
// => A/B 18,86 = 500/500
// ============================================================
{
  const result =
    parseOrder(
      `บล
18
86 } 500+500
28-8-69`
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "A18=500",
      "A86=500",
      "B18=500",
      "B86=500",
    ]
  );

  assert.equal(
    result.items.length,
    4
  );

  assert.equal(
    total(result),
    2000
  );

  console.log(
    "PASS P2K-02 production Review 1287"
  );
}


// ============================================================
// P2K-03
// Standalone 3-digit dash pair is an E/F assignment.
// ============================================================
{
  const result =
    parseOrder(
      "146-300x300"
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "E146=300",
      "F146=300",
    ]
  );

  assert.equal(
    total(result),
    600
  );

  console.log(
    "PASS P2K-03 standalone 3-digit dash pair"
  );
}


// ============================================================
// P2K-04
// '+' works with the same 3-digit dash assignment grammar.
// ============================================================
{
  const result =
    parseOrder(
      "146-300+300"
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "E146=300",
      "F146=300",
    ]
  );

  console.log(
    "PASS P2K-04 plus 3-digit dash pair"
  );
}


// ============================================================
// P2K-05
// Production Review #1288.
// ============================================================
{
  const result =
    parseOrder(
      `146-300x300
46-300x300
64-300x300
37=50*50
73=50*50`
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "A37=50",
      "A46=300",
      "A64=300",
      "A73=50",
      "B37=50",
      "B46=300",
      "B64=300",
      "B73=50",
      "E146=300",
      "F146=300",
    ]
  );

  assert.equal(
    result.items.length,
    10
  );

  assert.equal(
    total(result),
    2000
  );

  console.log(
    "PASS P2K-05 production Review 1288"
  );
}


// ============================================================
// P2K-SAFETY-01
// '-' only means assignment when RHS is a complete PAIR.
// ============================================================
for (const text of [
  "123-456",
  "123-50",
  "123-50x",
  "123--50x50",
]) {
  const result =
    parseOrder(text);

  assert.notEqual(
    result.status,
    "PARSED",
    `${text} must not become a valid dash-pair assignment`
  );

  assert.equal(
    result.items.length,
    0,
    `${text} must create zero canonical items`
  );
}

console.log(
  "PASS P2K-SAFETY-01 dash assignment remains narrow"
);


// ============================================================
// P2K-SAFETY-02
// Existing natural E/F pair remains unchanged.
// ============================================================
{
  const result =
    parseOrder(
      "123 50x50"
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "E123=50",
      "F123=50",
    ]
  );

  console.log(
    "PASS P2K-SAFETY-02 natural E/F pair unchanged"
  );
}


// ============================================================
// P2K-SAFETY-03
// Existing low-second-value ambiguity stays fail-closed.
// ============================================================
{
  const result =
    parseOrder(
      "249 5*5"
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
        "AMBIGUOUS_3DIGIT_NATURAL_PAIR"
    )
  );

  console.log(
    "PASS P2K-SAFETY-03 ambiguous natural pair remains REVIEW"
  );
}


// ============================================================
// P2K-SAFETY-04
// Existing repeated-permutation grammar stays unchanged.
// ============================================================
for (const text of [
  "229=50*50*50",
  "229=50x50x50",
]) {
  const result =
    parseOrder(text);

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    [
      "E229=50",
      "E292=50",
      "E922=50",
    ]
  );
}

console.log(
  "PASS P2K-SAFETY-04 repeated permutation unchanged"
);


// ============================================================
// P2K-SAFETY-05
// Existing explicit permutation count validation stays.
// ============================================================
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

  console.log(
    "PASS P2K-SAFETY-05 permutation mismatch unchanged"
  );
}


// ============================================================
// P2K-SAFETY-06
// '+' means exactly TWO quantities.
// 3+ '+' values have no permutation semantics and must fail closed.
// ============================================================
for (const text of [
  "229=50+50+50",
  "229=50+50+50+50",
]) {
  const result =
    parseOrder(text);

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
        "UNSUPPORTED_QUANTITY_EXPRESSION"
    )
  );

  assert.ok(
    result.rule_ids.includes(
      "R_3DIGIT_UNSUPPORTED_PLUS_CHAIN"
    )
  );
}

console.log(
  "PASS P2K-SAFETY-06 plus chain fails closed"
);


console.log(
  "PASS: production parser P2K pair separators + dash assignment v9.13"
);
