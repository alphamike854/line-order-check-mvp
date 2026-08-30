import assert from "node:assert/strict";
import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

assert.ok(
  ["1.7.0", "1.7.1", "1.7.2", "1.7.3", "1.7.4", "1.7.5", "1.7.6", "1.7.7", "1.7.8"].includes(PARSER_VERSION),
);

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

function expectedAB(codes, first, second = first) {
  const out = {};

  for (const code of codes) {
    out[`A${code}`] = first;
    out[`B${code}`] = second;
  }

  return out;
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
    `expected PARSED, got ${result.status}; ` +
      `errors=${JSON.stringify(result.errors)} ` +
      `warnings=${JSON.stringify(result.warnings)}`
  );

  assert.deepEqual(byKey(result), expected);
  assert.deepEqual(result.errors, []);
}


// ============================================================
// 2A1-01
//
// Production Review #615:
//
// 17-500*500
// 71-500*500
// ...
//
// 2-digit dash + explicit PAIR quantity.
// Equivalent to NN=qty*qty.
// ============================================================
check("2A1-01 2-digit dash pair block", () => {
  assertParsed(
    `17-500*500
71-500*500
25-500*500
52-500*500
39-500*500
93-500*500`,
    expectedAB(
      ["17", "71", "25", "52", "39", "93"],
      500,
      500
    )
  );
});


// ============================================================
// 2A1-02
//
// Explicit combined context is compatible with the same rule.
// ============================================================
check("2A1-02 dash pairs under บ-ล context", () => {
  assertParsed(
    `บ-ล
33-20*20
88-20*20
30-10*10
03-10*10
80-10*10
08-10*10
160฿`,
    {
      ...expectedAB(["33", "88"], 20, 20),
      ...expectedAB(
        ["30", "03", "80", "08"],
        10,
        10
      ),
    }
  );
});


// ============================================================
// 2A1-03
//
// Production uses Unicode multiplication sign too.
// ============================================================
check("2A1-03 Unicode multiplication sign", () => {
  assertParsed(
    "96-25×25",
    expectedAB(["96"], 25, 25)
  );
});


// ============================================================
// 2A1-04
//
// Local recovery only.
//
// 832-100*100 remains unsupported because it is a
// single 3-digit dash pair.
//
// But 32-50*50 / 23-50*50 can safely become A/B items.
// ============================================================
check("2A1-04 mixed 3-digit safety + 2-digit recovery", () => {
  const result = parseOrder(`832-100*100
32-50*50
23-50*50`);

  assert.ok(
    result.status === "REVIEW" ||
    result.status === "PARTIAL"
  );

  assert.deepEqual(
    byKey(result),
    expectedAB(["32", "23"], 50, 50)
  );

  assert.equal(
    result.items.some(
      (item) => item.code === "832"
    ),
    false,
    "must not manufacture canonical 832"
  );
});


// ============================================================
// SAFETY-01
//
// Existing A3/A5 boundary:
// lone 3-digit dash pair remains unsupported.
// ============================================================
check("SAFETY-01 single 3-digit dash pair remains safe", () => {
  const result = parseOrder("593-50*50");

  assert.notEqual(result.status, "PARSED");

  assert.equal(
    result.items.some(
      (item) => item.code === "593"
    ),
    false
  );
});


// ============================================================
// SAFETY-02
//
// Date/range-looking dash expression must not be interpreted
// as A22/B22 quantity.
// ============================================================
check("SAFETY-02 NN-NN-NN remains outside 2A1", () => {
  const result = parseOrder("22-10-10");

  assert.equal(result.items.length, 0);

  assert.equal(
    result.items.some(
      (item) =>
        item.category === "A" &&
        item.code === "22"
    ),
    false
  );
});


// ============================================================
// SAFETY-03
//
// Single quantity is NOT part of this phase.
// ============================================================
check("SAFETY-03 NN-single quantity remains outside 2A1", () => {
  const result = parseOrder("77-50");

  assert.equal(result.items.length, 0);
  assert.notEqual(result.status, "PARSED");
});


// ============================================================
// SAFETY-04
//
// Dash + single qty + modifier is Phase 2A2 candidate,
// not 2A1.
// ============================================================
check("SAFETY-04 dash single + modifier remains outside 2A1", () => {
  const result = parseOrder("71-25 บลก");

  assert.equal(result.items.length, 0);
  assert.notEqual(result.status, "PARSED");
});


// ============================================================
// SAFETY-05
//
// Code-list + trailing quantity is a different grammar.
// ============================================================
check("SAFETY-05 NN-NN-qty remains outside 2A1", () => {
  const result = parseOrder("68-86-100");

  assert.equal(result.items.length, 0);
  assert.notEqual(result.status, "PARSED");
});


if (failures.length) {
  console.error(
    `\n2A1 RED: ${failures.length} capability/safety test(s) failing`
  );

  process.exitCode = 1;
} else {
  console.log(
    "\nPASS: Review 2-digit dash pair grammar Phase 2A1"
  );
}
