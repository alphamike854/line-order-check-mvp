import assert from "node:assert/strict";

import {
  parseOrder,
} from "./src/lib/order-parser.mjs";


function canonical(result) {
  return [...(result.items || [])]
    .map(
      (item) =>
        `${item.category}${item.code}=${Number(
          item.quantity
        )}`
    )
    .sort();
}


function assertSameAsCanonical(
  name,
  raw,
  corrected
) {
  const expected = parseOrder(corrected);
  const actual = parseOrder(raw);

  assert.equal(
    expected.status,
    "PARSED",
    `${name}: canonical baseline must be PARSED`
  );

  assert.equal(
    actual.status,
    "PARSED",
    `${name}: direction header must be PARSED`
  );

  assert.deepEqual(
    actual.errors,
    [],
    `${name}: direction header must have no errors`
  );

  assert.deepEqual(
    canonical(actual),
    canonical(expected),
    `${name}: raw and canonical semantics differ`
  );

  console.log(`PASS ${name}`);
}


// Confirmed production Gold:
// บน400 ล่าง400🇱🇦
// 51-95-86-48-34
assertSameAsCanonical(
  "DQH-01 production Gold + flag + hyphen codes",
  `บน400 ล่าง400🇱🇦
51-95-86-48-34`,
  `51 95 86 48 34=400x400`
);


// Same confirmed grammar without decorative flag.
assertSameAsCanonical(
  "DQH-02 compact symmetric header",
  `บน500 ล่าง500
62 57 86`,
  `62 57 86=500x500`
);


// Whitespace differences must not alter the same grammar.
assertSameAsCanonical(
  "DQH-03 spaced symmetric header",
  `บน 500 ล่าง 500
62 57 86`,
  `62 57 86=500x500`
);


// Pure 2-digit blocks may span multiple lines.
assertSameAsCanonical(
  "DQH-04 multiline 2-digit code block",
  `บน500 ล่าง500
62
57
86`,
  `62 57 86=500x500`
);


// Header without following 2-digit codes must not manufacture
// an order.
for (const text of [
  "บน500 ล่าง500",
  "บน500 ล่าง500🇱🇦",
]) {
  const result = parseOrder(text);

  assert.deepEqual(
    result.items,
    [],
    text
  );
}

console.log(
  "PASS DQH-SAFETY-01 header alone creates no items"
);


// This first production phase is deliberately symmetric.
// Different TOP/BOTTOM quantities remain fail-closed until
// separate production Gold confirms that family.
{
  const text = `บน500 ล่าง300
62 57 86`;

  const result = parseOrder(text);

  assert.notEqual(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    result.items,
    []
  );
}

console.log(
  "PASS DQH-SAFETY-02 asymmetric header remains fail-closed"
);


// Never reinterpret 3-digit blocks as 2-digit A/B orders.
for (const text of [
  `123
บน500 ล่าง500`,
  `249
บน500 ล่าง500`,
  `บน500 ล่าง500
123`,
  `บน500 ล่าง500
249`,
]) {
  const result = parseOrder(text);

  assert.deepEqual(
    result.items,
    [],
    `3-digit boundary contaminated: ${text}`
  );
}

console.log(
  "PASS DQH-SAFETY-03 3-digit boundary remains isolated"
);


// Existing contextual direction grammar remains authoritative.
{
  const top = parseOrder("01=500 บน");
  const bottom = parseOrder("01=500 ล่าง");
  const threeTop = parseOrder("123=500 บน");
  const threeBottom = parseOrder("123=500 ล่าง");

  assert.deepEqual(
    canonical(top),
    ["A01=500"]
  );

  assert.deepEqual(
    canonical(bottom),
    ["B01=500"]
  );

  assert.deepEqual(
    canonical(threeTop),
    ["E123=500"]
  );

  assert.deepEqual(
    canonical(threeBottom),
    ["G123=500"]
  );
}

console.log(
  "PASS DQH-SAFETY-04 existing contextual directions unchanged"
);

console.log(
  "PASS: symmetric direction quantity header production grammar v9.27"
);
