import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

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
  return code.split("").reverse().join("");
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

  return pairAB(expanded, qty);
}

// ------------------------------------------------------------
// P1-01
// Mixed multiline 3-digit E/F + terminal 2-digit บลก block.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `643
431
136
164
-20*30

64
63
61
43
41
31
71-25 บลก`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 36);
  assert.equal(total(result), 900);

  assert.deepEqual(
    canonical(result),
    [
      "E643=20",
      "F643=30",
      "E431=20",
      "F431=30",
      "E136=20",
      "F136=30",
      "E164=20",
      "F164=30",
      ...blg(
        ["64", "63", "61", "43", "41", "31", "71"],
        25
      ),
    ].sort()
  );

  console.log(
    "PASS P1-01 mixed multiline terminal บลก"
  );
}

// ------------------------------------------------------------
// P1-02
// Context-confirmed single 3-digit dash pair followed by P1A.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `572-50*50

57
52
72-50 บลก`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 14);
  assert.equal(total(result), 700);

  assert.deepEqual(
    canonical(result),
    [
      "E572=50",
      "F572=50",
      ...blg(
        ["57", "52", "72"],
        50
      ),
    ].sort()
  );

  console.log(
    "PASS P1-02 contextual 3-digit dash + 2-digit block"
  );
}

// ------------------------------------------------------------
// P2K contract:
// standalone 3-digit dash pair is an E/F assignment.
// ------------------------------------------------------------
{
  const result =
    parseOrder("572-50*50");

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "E572=50",
      "F572=50",
    ]
  );

  console.log(
    "PASS P1-SAFETY-01 standalone 3-digit dash uses E/F"
  );
}

// ------------------------------------------------------------
// A valid 3-digit dash assignment must remain isolated from
// the following 2-digit order and must never leak quantity tokens.
// ------------------------------------------------------------
{
  const result =
    parseOrder(`572-50*50
01=20`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "A01=20",
      "E572=50",
      "F572=50",
    ]
  );

  assert.equal(
    canonical(result).some(
      (key) =>
        key.startsWith("A50=") ||
        key.startsWith("B50=") ||
        key.startsWith("A05=") ||
        key.startsWith("B05=")
    ),
    false
  );

  console.log(
    "PASS P1-SAFETY-02 no single-quantity contamination"
  );
}

{
  const result =
    parseOrder(`572-50*50
01=20x20`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "A01=20",
      "B01=20",
      "E572=50",
      "F572=50",
    ]
  );

  assert.equal(
    canonical(result).some(
      (key) =>
        key.startsWith("A50=") ||
        key.startsWith("B50=") ||
        key.startsWith("A05=") ||
        key.startsWith("B05=")
    ),
    false
  );

  console.log(
    "PASS P1-SAFETY-03 no pair-quantity contamination"
  );
}

// Existing canonical syntax must remain unchanged.
{
  const result =
    parseOrder("572=50*50");

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      "E572=50",
      "F572=50",
    ]
  );

  console.log(
    "PASS P1-SAFETY-04 explicit E/F unchanged"
  );
}

console.log(
  "PASS: production parser P1 regression v9.3"
);
