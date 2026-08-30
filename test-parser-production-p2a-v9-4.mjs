import assert from "node:assert/strict";
import {
  parseOrder,
} from "./src/lib/order-parser.mjs";

function canonical(result) {
  return [...(result.items || [])]
    .map(
      (item) =>
        `${item.category}${item.code}=${Number(item.quantity)}`
    )
    .sort();
}

function total(result) {
  return (result.items || []).reduce(
    (sum, item) =>
      sum + Number(item.quantity || 0),
    0
  );
}

function reverse2(code) {
  return code
    .split("")
    .reverse()
    .join("");
}

function pairAB(codes, qty) {
  return codes.flatMap((code) => [
    `A${code}=${qty}`,
    `B${code}=${qty}`,
  ]);
}

function blg(codes, qty) {
  const expanded = [
    ...new Set(
      codes.flatMap((code) => [
        code,
        reverse2(code),
      ])
    ),
  ];

  return pairAB(
    expanded,
    qty
  ).sort();
}

// ------------------------------------------------------------
// P2A-01
// Completed บลก order followed only by natural metadata.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "19 75 56 -300 บลก ลาวค่ะ\n\nน้องฝน"
  );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    12
  );

  assert.equal(
    total(result),
    3600
  );

  assert.deepEqual(
    canonical(result),
    blg(
      ["19", "75", "56"],
      300
    )
  );

  console.log(
    "PASS P2A-01 trailing natural metadata after บลก"
  );
}

// ------------------------------------------------------------
// P2A-SAFETY-01
// Existing canonical grammar without suffix remains unchanged.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "19 75 56 -300 บลก"
  );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    12
  );

  assert.equal(
    total(result),
    3600
  );

  assert.deepEqual(
    canonical(result),
    blg(
      ["19", "75", "56"],
      300
    )
  );

  console.log(
    "PASS P2A-SAFETY-01 existing บลก unchanged"
  );
}

// ------------------------------------------------------------
// P2A-SAFETY-02
// Competing order syntax on the SAME line must fail closed.
//
// Existing 1.7.3 bug:
//   19 75 56 -300 บลก 01=20
//
// was incorrectly PARSED with quantity 20 applied across the
// previous code block.
// ------------------------------------------------------------
{
  const cases = [
    "19 75 56 -300 บลก 01=20",
    "19 75 56 -300 บลก 123=20",
    "19 75 56 -300 บลก 01=20x20",
  ];

  for (const text of cases) {
    const result = parseOrder(text);

    assert.notEqual(
      result.status,
      "PARSED",
      text
    );

    assert.equal(
      result.errors.some(
        (error) =>
          error.code ===
          "AMBIGUOUS_SAME_LINE_ORDER_SYNTAX"
      ),
      true,
      text
    );
  }

  console.log(
    "PASS P2A-SAFETY-02 same-line competing orders fail closed"
  );
}

// ------------------------------------------------------------
// P2A-SAFETY-03
// The same two orders on separate lines remain valid.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `19 75 56 -300 บลก
01=20`
  );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.equal(
    result.items.length,
    13
  );

  assert.equal(
    total(result),
    3620
  );

  assert.equal(
    canonical(result).includes(
      "A01=20"
    ),
    true
  );

  assert.deepEqual(
    canonical(result)
      .filter(
        (item) =>
          item !== "A01=20"
      ),
    blg(
      ["19", "75", "56"],
      300
    )
  );

  console.log(
    "PASS P2A-SAFETY-03 separate-line orders remain valid"
  );
}

console.log(
  "PASS: production parser P2A regression v9.4"
);
