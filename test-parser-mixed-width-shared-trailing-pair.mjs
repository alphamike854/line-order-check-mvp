import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
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
    0,
  );
}

function ef(codes, qty) {
  return codes.flatMap(
    (code) => [
      `E${code}=${qty}`,
      `F${code}=${qty}`,
    ],
  );
}

function ab(codes, qty) {
  return codes.flatMap(
    (code) => [
      `A${code}=${qty}`,
      `B${code}=${qty}`,
    ],
  );
}

const THREE = [
  "930",
  "039",
  "903",
  "309",
  "390",
  "093",
  "850",
  "085",
  "580",
  "508",
  "805",
  "058",
];

// ------------------------------------------------------------
// REGRESSION-01
//
// Multiple explicit 3-digit codes followed immediately by a
// genuine 2-digit block whose terminal line carries an A/B pair.
//
// The terminal pair closes BOTH adjacent width blocks:
//
// 3-digit => E/F
// 2-digit => A/B
//
// Explicit 3-digit codes are NOT permutation seeds.
// ------------------------------------------------------------
{
  const result = parseOrder(`930
039
903
309
390
093
850
085
580
508
805
058
90
09=50×50`);

  assert.equal(
    result.status,
    "PARSED",
  );

  assert.deepEqual(
    canonical(result),
    [
      ...ef(THREE, 50),
      ...ab(["90", "09"], 50),
    ].sort(),
  );

  assert.equal(
    result.items.length,
    28,
  );

  assert.equal(
    total(result),
    1400,
  );

  console.log(
    "PASS MW-SHARED-01 3-digit + 2-digit shared trailing pair"
  );
}

// ------------------------------------------------------------
// REGRESSION-02
// Same grammar when several 2-digit codes occur on the
// terminal assignment line.
// ------------------------------------------------------------
{
  const result = parseOrder(`930
039
903
90 09=50x50`);

  assert.equal(
    result.status,
    "PARSED",
  );

  assert.deepEqual(
    canonical(result),
    [
      ...ef(
        ["930", "039", "903"],
        50,
      ),
      ...ab(
        ["90", "09"],
        50,
      ),
    ].sort(),
  );

  assert.equal(
    total(result),
    500,
  );

  console.log(
    "PASS MW-SHARED-02 terminal 2-digit list closes both blocks"
  );
}

// ------------------------------------------------------------
// SAFETY-01
//
// Historical safety stays intact.
// Multiple pending 3-digit codes followed only by a bare pair
// must NOT suddenly inherit that pair.
// ------------------------------------------------------------
{
  const result = parseOrder(`930
039
50x50`);

  const emittedEF =
    (result.items || []).filter(
      (item) =>
        item.category === "E"
        || item.category === "F"
    );

  assert.equal(
    emittedEF.length,
    0,
  );

  console.log(
    "PASS MW-SHARED-SAFETY-01 bare pair still cannot close multi-3-digit block"
  );
}

// ------------------------------------------------------------
// SAFETY-02
//
// One trailing 2-digit code is not enough evidence to declare
// a separate 2-digit block. Do not widen the inference.
// ------------------------------------------------------------
{
  const result = parseOrder(`930
039
09=50x50`);

  const emittedEF =
    (result.items || []).filter(
      (item) =>
        item.category === "E"
        || item.category === "F"
    );

  assert.equal(
    emittedEF.length,
    0,
  );

  console.log(
    "PASS MW-SHARED-SAFETY-02 single terminal 2-digit code does not widen inference"
  );
}

// ------------------------------------------------------------
// SAFETY-03
// Existing single 3-digit pending-code pair grammar unchanged.
// ------------------------------------------------------------
{
  const result = parseOrder(`778
100x100`);

  assert.equal(
    result.status,
    "PARSED",
  );

  assert.deepEqual(
    canonical(result),
    [
      "E778=100",
      "F778=100",
    ],
  );

  console.log(
    "PASS MW-SHARED-SAFETY-03 existing single 3-digit pending pair unchanged"
  );
}

assert.equal(
  PARSER_VERSION,
  "1.7.25",
);

console.log(
  "PASS: mixed-width shared trailing pair regression"
);
