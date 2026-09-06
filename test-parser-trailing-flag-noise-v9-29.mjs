import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";


function canonical(result) {
  return [...(result.items || [])]
    .map(
      item =>
        `${item.category}${item.code}=${Number(
          item.quantity
        )}`
    )
    .sort();
}


function assertDecoratedSame(
  name,
  clean,
  decorated
) {
  const expected = parseOrder(clean);
  const actual = parseOrder(decorated);

  assert.equal(
    expected.status,
    "PARSED",
    `${name}: clean baseline must be PARSED`
  );

  assert.equal(
    actual.status,
    "PARSED",
    `${name}: trailing decoration changed parse status`
  );

  assert.deepEqual(
    actual.errors,
    [],
    `${name}: decorated order must have no errors`
  );

  assert.deepEqual(
    canonical(actual),
    canonical(expected),
    `${name}: trailing decoration changed order semantics`
  );

  console.log(`PASS ${name}`);
}


console.log(
  "PARSER_VERSION=" + PARSER_VERSION
);


// Confirmed production family: modifier/pair header.
assertDecoratedSame(
  "TFN-01 modifier header",
  `บลก 700x700
28-97-70-03-53`,
  `บลก 700x700 🇱🇦
28-97-70-03-53`
);


// Repeated decorative flags must have no semantic effect.
assertDecoratedSame(
  "TFN-02 repeated trailing flags",
  `บลก 700x700
28 97`,
  `บลก 700x700 🇱🇦🇱🇦
28 97`
);


// Explicit 3-digit TOD assignment.
assertDecoratedSame(
  "TFN-03 three-digit TOD",
  `639=100 โต๊ด`,
  `639=100 โต๊ด 🇱🇦`
);


// Existing direction-header family must no longer need
// flag-specific grammar.
assertDecoratedSame(
  "TFN-04 direction header",
  `บน400 ล่าง400
51-95-86-48-34`,
  `บน400 ล่าง400🇱🇦
51-95-86-48-34`
);


// Explicit inline order.
assertDecoratedSame(
  "TFN-05 contextual inline assignment",
  `01=500 บน`,
  `01=500 บน 🇱🇦`
);


// Canonical quantity pair.
assertDecoratedSame(
  "TFN-06 canonical quantity pair",
  `51 95=500x500`,
  `51 95=500x500 🇱🇦`
);


// ------------------------------------------------------------
// Metadata safety.
// Decorative-flag normalization must NOT reinterpret these
// existing chat metadata forms as orders.
// ------------------------------------------------------------

for (const text of [
  "🇱🇦รวม 60",
  "🇱🇦ดอม1080",
  "2,400฿🇱🇦🇱🇦 พี่แอ๋ม",
  "พี่อีฟเบญ🇱🇦120฿",
  "นุ้ย 80.-🇱🇦",
  "ต่าย🇱🇦",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "IGNORE",
    text
  );

  assert.deepEqual(
    result.items,
    [],
    text
  );

  assert.deepEqual(
    result.errors,
    [],
    text
  );
}

console.log(
  "PASS TFN-SAFETY-01 metadata remains metadata"
);


// Summary decoration plus a real order must retain only the
// actual order.
{
  const result = parseOrder(
    `🇱🇦รวม 60
01=20`
  );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    canonical(result),
    ["A01=20"]
  );
}

console.log(
  "PASS TFN-SAFETY-02 decorated summary cannot contaminate order"
);


// This phase is intentionally limited to the confirmed Laos
// flag decoration. Do not silently generalize another flag.
{
  const result = parseOrder(
    `บลก 700x700 🇹🇭
28 97`
  );

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
  "PASS TFN-SAFETY-03 unconfirmed flag remains outside normalization"
);


console.log(
  "PASS: trailing decorative flag noise grammar v9.29"
);
