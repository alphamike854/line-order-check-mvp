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


function assertSameAsCorrected(
  name,
  raw,
  corrected
) {
  const expected = parseOrder(corrected);
  const actual = parseOrder(raw);

  assert.equal(
    expected.status,
    "PARSED",
    `${name}: corrected Gold must be PARSED`
  );

  assert.equal(
    actual.status,
    "PARSED",
    `${name}: raw production grammar must be PARSED`
  );

  assert.deepEqual(
    actual.errors,
    [],
    `${name}: raw production grammar must have no errors`
  );

  assert.deepEqual(
    canonical(actual),
    canonical(expected),
    `${name}: raw and human-corrected semantics differ`
  );

  console.log(`PASS ${name}`);
}


// Production Review 6147
assertSameAsCorrected(
  "MQ-01 slash list + attached บลก quantity",
  "28/12 บลก3000",
  "28/12=3000 บลก"
);


// Production Review 6152
assertSameAsCorrected(
  "MQ-02 multi slash list + attached บลก quantity",
  "12/18/28 บลก1000",
  "12/18/28=1000 บลก"
);


// Production Review 6096
assertSameAsCorrected(
  "MQ-03 single code + spaced comma quantity",
  "28 บลก 1,000",
  "28=1,000 บลก"
);


// Production Review 4798
assertSameAsCorrected(
  "MQ-04 two natural modifier blocks",
  `17/82/84/24/78/72/74 บลก30

11/77/88/44/22/33 บล20`,
  `17/82/84/24/78/72/74=30 บลก

11/77/88/44/22/33=20 บล`
);


// Pending codes from a previous line must be closed by the
// final code + natural modifier quantity.
assertSameAsCorrected(
  "MQ-05 pending multiline codes",
  `01
10 บล50`,
  `01 10=50 บล`
);


// Dash-separated natural forms exist in production Review,
// but do not yet have a human-corrected Gold record in this
// grammar family. Keep them fail-closed until separately
// confirmed instead of widening this production rule.
for (const text of [
  "95-90-19-78-10-89บลก100",
  "78-89- บลก20",
]) {
  const result = parseOrder(text);

  assert.notEqual(
    result.status,
    "PARSED",
    `unconfirmed dash grammar must remain Review-safe: ${text}`
  );

  assert.deepEqual(
    result.items,
    [],
    `unconfirmed dash grammar must not create items: ${text}`
  );
}

console.log(
  "PASS MQ-SAFETY-01 unconfirmed dash grammar remains fail-closed"
);


// Existing canonical forms remain unchanged.
for (const text of [
  "28=3000 บลก",
  "28/12=3000 บลก",
  "01 02 03=20 บลก",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    `canonical grammar changed: ${text}`
  );

  assert.deepEqual(
    result.errors,
    [],
    `canonical grammar gained errors: ${text}`
  );
}

console.log(
  "PASS: natural modifier quantity production grammar v9.25"
);
