import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

function itemMap(result) {
  const map = new Map();

  for (const item of result.items ?? []) {
    map.set(
      `${item.category}:${item.code}`,
      Number(item.quantity),
    );
  }

  return map;
}

function assertItem(
  map,
  category,
  code,
  quantity,
) {
  assert.equal(
    map.get(`${category}:${code}`),
    quantity,
    `${category}${code} must equal ${quantity}`,
  );
}

function assertNoUnexpectedItems(
  result,
  expectedCount,
) {
  assert.equal(
    result.items?.length ?? 0,
    expectedCount,
    `expected exactly ${expectedCount} canonical items`,
  );
}

console.log(
  `F02_GOLD_PARSER_VERSION=${PARSER_VERSION}`,
);

// ------------------------------------------------------------
// GOLD-01
// Production Review 13950.
//
// Two adjacent blocks have independent width + quantity:
//
//   019 / 910       -> E/F 15
//   01/10/91/19     -> A/B 50
//
// Critical regression:
// the 15x15 belonging to the 3-digit block must NOT leak
// into the following 2-digit block.
// ------------------------------------------------------------

{
  const input = `019
910
15*15
01
10
91
19
50*50`;

  const result = parseOrder(input);

  assert.equal(
    result.status,
    "PARSED",
    "GOLD-01 mixed blocks should fully parse",
  );

  const items = itemMap(result);

  for (const code of ["019", "910"]) {
    assertItem(items, "E", code, 15);
    assertItem(items, "F", code, 15);
  }

  for (const code of ["01", "10", "91", "19"]) {
    assertItem(items, "A", code, 50);
    assertItem(items, "B", code, 50);
  }

  assertNoUnexpectedItems(
    result,
    12,
  );

  assert.deepEqual(
    result.errors ?? [],
    [],
    "GOLD-01 must not retain parser errors",
  );

  console.log(
    "PASS GOLD-01 production 13950 independent 3D -> 2D blocks",
  );
}

// ------------------------------------------------------------
// GOLD-02
// Production Review 13937.
//
//   394/588/847/998    -> E/F 20
//   15/51/17/71/77     -> A/B 40
//
// Current production parser 1.7.25 incorrectly gives
// the 2-digit block quantity 20 from the preceding block.
// ------------------------------------------------------------

{
  const input = `394
588
847
998
20*20
15
51
17
71
77
40*40`;

  const result = parseOrder(input);

  assert.equal(
    result.status,
    "PARSED",
    "GOLD-02 mixed blocks should fully parse",
  );

  const items = itemMap(result);

  for (
    const code of [
      "394",
      "588",
      "847",
      "998",
    ]
  ) {
    assertItem(items, "E", code, 20);
    assertItem(items, "F", code, 20);
  }

  for (
    const code of [
      "15",
      "51",
      "17",
      "71",
      "77",
    ]
  ) {
    assertItem(items, "A", code, 40);
    assertItem(items, "B", code, 40);
  }

  assertNoUnexpectedItems(
    result,
    18,
  );

  assert.deepEqual(
    result.errors ?? [],
    [],
    "GOLD-02 must not retain parser errors",
  );

  console.log(
    "PASS GOLD-02 production 13937 independent 3D -> 2D blocks",
  );
}

// ------------------------------------------------------------
// GOLD-03
// Exact production Review 13950.
//
// Blank formatting separates the independently quantified
// 3-digit and 2-digit blocks:
//
//   019 / 910       -> E/F 15
//
//   01/10/91/19     -> A/B 50
//
// "ป้อน" is ordinary trailing chat/noise and is intentionally
// irrelevant to order semantics.
//
// The blank line must NOT terminate F02 ownership recognition.
// ------------------------------------------------------------

{
  const input = `019
910
15*15

01
10
91
19
50*50

ป้อน`;

  const result = parseOrder(input);

  assert.equal(
    result.status,
    "PARSED",
    "GOLD-03 exact production 13950 with blank formatting should parse",
  );

  const items = itemMap(result);

  for (const code of ["019", "910"]) {
    assertItem(items, "E", code, 15);
    assertItem(items, "F", code, 15);
  }

  for (const code of ["01", "10", "91", "19"]) {
    assertItem(items, "A", code, 50);
    assertItem(items, "B", code, 50);
  }

  assertNoUnexpectedItems(
    result,
    12,
  );

  assert.deepEqual(
    result.errors ?? [],
    [],
    "GOLD-03 must not retain parser errors",
  );

  console.log(
    "PASS GOLD-03 production 13950 blank boundary + trailing noise",
  );
}


// ------------------------------------------------------------
// SAFETY-04
//
// Blank formatting and harmless trailing noise must NOT widen
// the existing fail-closed rule for a pure multi-3-digit block.
// ------------------------------------------------------------

{
  const result = parseOrder(`935
539
359
50*50

ป้อน`);

  assert.equal(
    result.status,
    "REVIEW",
    "SAFETY-04 pure multi-3D block must remain REVIEW",
  );

  assert.equal(
    result.items?.length ?? 0,
    0,
    "SAFETY-04 must not invent E/F items",
  );

  console.log(
    "PASS SAFETY-04 blank/noise does not widen pure multi-3D inference",
  );
}


// ------------------------------------------------------------
// SAFETY-01
//
// Do NOT widen this phase into:
// multiple bare 3-digit codes + bare pair.
//
// Existing parser contract intentionally keeps this REVIEW-safe.
// ------------------------------------------------------------

{
  const result = parseOrder(`935
539
359
50*50`);

  assert.equal(
    result.status,
    "REVIEW",
    "SAFETY-01 pure multi-3D bare-pair block must remain REVIEW",
  );

  assert.equal(
    result.items?.length ?? 0,
    0,
    "SAFETY-01 must not invent E/F items",
  );

  console.log(
    "PASS SAFETY-01 pure multi-3D bare pair remains fail-closed",
  );
}

// ------------------------------------------------------------
// SAFETY-02
//
// Existing single 3-digit + bare pair semantics remain unchanged.
// ------------------------------------------------------------

{
  const result = parseOrder(`086
20*20`);

  assert.equal(
    result.status,
    "PARSED",
    "SAFETY-02 existing single 3D pair grammar must remain",
  );

  const items = itemMap(result);

  assertItem(items, "E", "086", 20);
  assertItem(items, "F", "086", 20);

  assertNoUnexpectedItems(
    result,
    2,
  );

  console.log(
    "PASS SAFETY-02 single 3D pair grammar unchanged",
  );
}

// ------------------------------------------------------------
// SAFETY-03
//
// Existing 2-digit bare block + pair behavior remains unchanged.
// ------------------------------------------------------------

{
  const result = parseOrder(`06
60
09
90
50*50`);

  assert.equal(
    result.status,
    "PARSED",
    "SAFETY-03 2D block must remain canonical",
  );

  const items = itemMap(result);

  for (
    const code of [
      "06",
      "60",
      "09",
      "90",
    ]
  ) {
    assertItem(items, "A", code, 50);
    assertItem(items, "B", code, 50);
  }

  assertNoUnexpectedItems(
    result,
    8,
  );

  console.log(
    "PASS SAFETY-03 existing 2D trailing pair unchanged",
  );
}

console.log(
  "PASS: F02 mixed-width block boundary Gold contract",
);
