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


function assertSameAsSpacedHeader(
  name,
  compact,
  spaced
) {
  const expected = parseOrder(spaced);
  const actual = parseOrder(compact);

  assert.equal(
    expected.status,
    "PARSED",
    `${name}: spaced A5 baseline must be PARSED`
  );

  assert.equal(
    actual.status,
    "PARSED",
    `${name}: compact header must be PARSED`
  );

  assert.deepEqual(
    actual.errors,
    [],
    `${name}: compact header must have no errors`
  );

  assert.deepEqual(
    canonical(actual),
    canonical(expected),
    `${name}: compact and spaced header semantics differ`
  );

  console.log(`PASS ${name}`);
}


assertSameAsSpacedHeader(
  "CH-01 attached star pair",
  `บลก50*50
62 57 86`,
  `บลก 50*50
62 57 86`
);


assertSameAsSpacedHeader(
  "CH-02 attached x pair",
  `บลก50x50
62 57 86`,
  `บลก 50x50
62 57 86`
);


assertSameAsSpacedHeader(
  "CH-03 attached multiplication pair",
  `บลก50×50
62 57 86`,
  `บลก 50×50
62 57 86`
);


// Do not turn a compact modifier + SINGLE number into
// a pair-quantity header.
{
  const result = parseOrder("บลก50");

  assert.notEqual(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    result.items,
    []
  );

  console.log(
    "PASS CH-SAFETY-01 attached single quantity stays fail-closed"
  );
}


// A pair header without following 2-digit codes must not
// manufacture an order.
{
  const result = parseOrder("บลก50x50");

  assert.deepEqual(
    result.items,
    []
  );

  console.log(
    "PASS CH-SAFETY-02 header alone creates no items"
  );
}


// Compact 2-digit header recovery must never capture a
// preceding 3-digit code block.
for (const text of [
  `249
บลก50x50`,
  `123
บลก50x50`,
]) {
  const result = parseOrder(text);

  assert.deepEqual(
    result.items,
    [],
    `3-digit boundary contaminated: ${text}`
  );
}

console.log(
  "PASS CH-SAFETY-03 3-digit boundary remains isolated"
);

// Compact syntax is currently confirmed only for บลก.
// Other composite aliases keep their existing whitespace
// requirement until separate production Gold confirms them.
for (const text of [
  `บล50x50
62 57 86`,
  `บ-ล50x50
62 57 86`,
  `บนล่าง50x50
62 57 86`,
]) {
  const result = parseOrder(text);

  assert.deepEqual(
    result.items,
    [],
    `unconfirmed compact modifier must remain fail-closed: ${text}`
  );

  assert.notEqual(
    result.status,
    "PARSED",
    `unconfirmed compact modifier unexpectedly parsed: ${text}`
  );
}

console.log(
  "PASS CH-SAFETY-04 other compact aliases remain fail-closed"
);


console.log(
  "PASS: compact modifier pair header production grammar v9.26"
);
