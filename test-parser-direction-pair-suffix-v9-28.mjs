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
    `${name}: direction suffix must be PARSED`
  );

  assert.deepEqual(
    actual.errors,
    [],
    `${name}: direction suffix must have no errors`
  );

  assert.deepEqual(
    canonical(actual),
    canonical(expected),
    `${name}: raw and canonical semantics differ`
  );

  console.log(`PASS ${name}`);
}


// Confirmed human-correction Gold.
// normalizeText() converts × -> x before this grammar.
assertSameAsCanonical(
  "DQS-01 production Gold multiplication suffix",
  `51
95
86
48
34
บน1500×ล่าง1500`,
  `51 95 86 48 34=1500x1500`
);


// x is the normalized representation of the same Gold syntax.
assertSameAsCanonical(
  "DQS-02 normalized x suffix",
  `51 95 86 48 34
บน1500xล่าง1500`,
  `51 95 86 48 34=1500x1500`
);


// Existing safe 2-digit list extraction may preserve hyphen layout.
assertSameAsCanonical(
  "DQS-03 hyphen code list",
  `51-95-86-48-34
บน1500×ล่าง1500`,
  `51 95 86 48 34=1500x1500`
);


// Suffix alone cannot manufacture an order.
for (const text of [
  "บน1500×ล่าง1500",
  "บน1500xล่าง1500",
]) {
  const result = parseOrder(text);

  assert.deepEqual(
    result.items,
    [],
    text
  );
}

console.log(
  "PASS DQS-SAFETY-01 suffix alone creates no items"
);


// Different quantities are a separate grammar family and
// remain Review-safe.
{
  const text = `51 95
บน1500xล่าง1000`;

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
  "PASS DQS-SAFETY-02 asymmetric suffix remains fail-closed"
);


// No Gold yet for alternate separator/spaceless semantic forms.
for (const text of [
  `51 95
บน1500*ล่าง1500`,
  `51 95
บน 1500 ล่าง 1500`,
]) {
  const result = parseOrder(text);

  assert.notEqual(
    result.status,
    "PARSED",
    text
  );

  assert.deepEqual(
    result.items,
    [],
    text
  );
}

console.log(
  "PASS DQS-SAFETY-03 unconfirmed suffix variants remain fail-closed"
);


// Never reinterpret 3-digit blocks as A/B.
for (const text of [
  `123
บน1500xล่าง1500`,
  `249
บน1500xล่าง1500`,
  `123 249
บน1500xล่าง1500`,
]) {
  const result = parseOrder(text);

  assert.deepEqual(
    result.items,
    [],
    `3-digit boundary contaminated: ${text}`
  );
}

console.log(
  "PASS DQS-SAFETY-04 3-digit boundary remains isolated"
);


// Existing canonical width semantics remain authoritative.
{
  const two = parseOrder(
    "51 95=1500x1500"
  );

  const three = parseOrder(
    "123 249=1500x1500"
  );

  assert.deepEqual(
    canonical(two),
    [
      "A51=1500",
      "A95=1500",
      "B51=1500",
      "B95=1500",
    ]
  );

  assert.deepEqual(
    canonical(three),
    [
      "E123=1500",
      "E249=1500",
      "F123=1500",
      "F249=1500",
    ]
  );
}

console.log(
  "PASS DQS-SAFETY-05 canonical 2/3-digit semantics unchanged"
);

console.log(
  "PASS: symmetric direction pair suffix production grammar v9.28"
);
