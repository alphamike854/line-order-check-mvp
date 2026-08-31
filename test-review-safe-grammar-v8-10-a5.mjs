import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

function byKey(result) {
  return Object.fromEntries(
    [...result.items]
      .sort((a, b) =>
        a.category.localeCompare(b.category) ||
        a.code.localeCompare(b.code)
      )
      .map((item) => [
        `${item.category}${item.code}`,
        Number(item.quantity),
      ])
  );
}

function expectedThreeDigitPair(codes, first, second) {
  const out = {};

  for (const code of codes) {
    out[`E${code}`] = first;
    out[`F${code}`] = second;
  }

  return out;
}

function expectedAB(codes, first, second = first) {
  const out = {};

  for (const code of codes) {
    out[`A${code}`] = first;
    out[`B${code}`] = second;
  }

  return out;
}

function expectedABReverse(codes, first, second = first) {
  const expanded = new Set();

  for (const code of codes) {
    expanded.add(code);
    expanded.add(code.split("").reverse().join(""));
  }

  return expectedAB([...expanded], first, second);
}

const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

function assertParsed(text, expected) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    `expected PARSED, got ${result.status}; errors=${JSON.stringify(result.errors)} warnings=${JSON.stringify(result.warnings)}`
  );

  assert.deepEqual(byKey(result), expected);

  assert.deepEqual(
    result.errors,
    [],
    "successful A5 grammar must not leave parser errors"
  );
}


// ============================================================
// A5-01
//
// Production Review:
// 247
// 471
// 712
// 124
// -50*50 บน
//
// Collective 3-digit code block.
// Pair quantity + บน keeps established E/F pair semantics.
// ============================================================
check("A5-01 3-digit pending block + trailing pair + บน", () => {
  assertParsed(
    `247
471
712
124
-50*50 บน`,
    expectedThreeDigitPair(
      ["247", "471", "712", "124"],
      50,
      50
    )
  );
});


// ============================================================
// A5-02
//
// Production Review:
// 643
// 431
// 136
// 164
// -20*30
//
// No explicit category + 3-digit pair => E/F.
// ============================================================
check("A5-02 3-digit pending block + trailing pair", () => {
  assertParsed(
    `643
431
136
164
-20*30`,
    expectedThreeDigitPair(
      ["643", "431", "136", "164"],
      20,
      30
    )
  );
});


// ============================================================
// A5-03
//
// Production Review:
// 753 539 397 975-50*50
//
// IMPORTANT:
// This collective grammar requires multiple 3-digit codes.
// It must NOT turn single-code 593-50*50 into an automatic order.
// ============================================================
check("A5-03 multi 3-digit collective dash pair", () => {
  assertParsed(
    "753 539 397 975-50*50",
    expectedThreeDigitPair(
      ["753", "539", "397", "975"],
      50,
      50
    )
  );
});


// ============================================================
// A5-04
//
// Production Review:
// บลก 1500*1500
// 53 37 96 45 48
//
// Header quantity/modifier applies to following 2-digit block.
// บลก = A + B + reverse.
// ============================================================
check("A5-04 modifier/quantity header before 2-digit codes", () => {
  assertParsed(
    `บลก 1500*1500

53 37 96 45 48`,
    expectedABReverse(
      ["53", "37", "96", "45", "48"],
      1500,
      1500
    )
  );
});


// ============================================================
// A5-05
//
// Production Review:
// 2000*2000
// 06
// 60
// ...
//
// Pair quantity header with no explicit category => A/B.
// ============================================================
check("A5-05 pair quantity header before 2-digit codes", () => {
  assertParsed(
    `2000*2000
06
60
71
17
24
42
82
28
29
92`,
    expectedAB(
      [
        "06", "60",
        "71", "17",
        "24", "42",
        "82", "28",
        "29", "92",
      ],
      2000,
      2000
    )
  );
});


// ============================================================
// A5-06
//
// Production Review:
// 78-500*500
// 87-500*500
// 12-500*500
// 21-500*500
// บนล่าง
//
// Trailing context applies to the preceding explicit assignments.
// ============================================================
check("A5-06 dash pair assignments + trailing บนล่าง", () => {
  assertParsed(
    `78-500*500
87-500*500
12-500*500
21-500*500
บนล่าง`,
    expectedAB(
      ["78", "87", "12", "21"],
      500,
      500
    )
  );
});


// ============================================================
// A5-07
//
// Production Review:
// valid order followed by:
//   ซื้อลาวค่ะ
//   28 สค. 69
//
// Thai textual date metadata must not become pending codes 28,69.
// ============================================================
check("A5-07 Thai textual date metadata after valid order", () => {
  assertParsed(
    `42 68 27 51 70 = 500 บลก

ซื้อลาวค่ะ
28 สค. 69`,
    expectedABReverse(
      ["42", "68", "27", "51", "70"],
      500,
      500
    )
  );
});

check("A5-07 Thai textual date alone is metadata", () => {
  const result = parseOrder("28 สค. 69");

  assert.equal(result.status, "IGNORE");
  assert.equal(result.items.length, 0);
  assert.equal(result.errors.length, 0);
});


// ============================================================
// P2K baseline:
//
// A standalone 3-digit dash pair is now a canonical
// E/F assignment.
// ============================================================
check("P2K-01 single 3-digit dash pair means E/F", () => {
  const result =
    parseOrder("593-50*50");

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    result.items
      .map(
        (item) =>
          `${item.category}${item.code}=${item.quantity}`
      )
      .sort(),
    [
      "E593=50",
      "F593=50",
    ]
  );
});


// ============================================================
// SAFETY-02
//
// Existing permutation ambiguity.
// ============================================================
check("SAFETY-02 historical permutation ambiguity remains", () => {
  const result = parseOrder("249 5*5");

  assert.ok(
    result.status === "REVIEW" ||
    result.status === "PARTIAL"
  );

  assert.equal(result.items.length, 0);

  assert.ok(
    result.errors.some(
      (error) =>
        error.code ===
        "AMBIGUOUS_3DIGIT_NATURAL_PAIR"
    )
  );
});


// ============================================================
// SAFETY-03
//
// Two bare 2-digit values must remain codes, not code+quantity.
// ============================================================
check("SAFETY-03 two bare 2-digit values remain ambiguous", () => {
  const result = parseOrder("72 27");

  assert.notEqual(result.status, "PARSED");
  assert.equal(result.items.length, 0);

  assert.ok(
    result.errors.some(
      (error) =>
        error.code ===
        "PENDING_CODES_WITHOUT_QUANTITY"
    )
  );
});


// ============================================================
// ============================================================
// SAFETY-04
//
// Sender/name shorthand that is not itself a complete order
// must not poison an otherwise valid order block.
//
// The numeral in "ยึด4" must not become an additional order
// code or quantity.
// ============================================================

check("SAFETY-04 sender shorthand does not poison valid order", () => {
  const result = parseOrder(`96
69
77
11
=25*25
200฿
ยึด4`);

  assert.equal(result.status, "PARSED");

  assert.equal(result.items.length, 8);

  assert.equal(
    result.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    ),
    200
  );

  assert.equal(result.errors.length, 0);

  assert.equal(
    result.items.some(
      (item) =>
        item.code === "4" ||
        item.code === "04"
    ),
    false,
    "sender shorthand numeral must not become an order code"
  );
});


if (failures.length) {
  console.error(
    `\nA5 BASELINE: ${failures.length} expected capability test(s) still failing`
  );

  process.exitCode = 1;
} else {
  console.log(
    "\nPASS: Review block grammar + Thai date safety v8.10 A5"
  );
}
