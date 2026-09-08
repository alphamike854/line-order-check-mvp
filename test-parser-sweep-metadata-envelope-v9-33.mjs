import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

assert.equal(
  PARSER_VERSION,
  "1.7.23",
  "v9.33 parser version",
);

function canonical(result) {
  return [...(result.items || [])]
    .map(
      (item) =>
        `${item.category}${item.code}=${Number(
          item.quantity,
        )}`,
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

function sameAsClean(
  name,
  cleanText,
  decoratedText,
  expectedItems,
  expectedTotal,
) {
  const clean = parseOrder(cleanText);
  const decorated = parseOrder(decoratedText);

  assert.equal(
    clean.status,
    "PARSED",
    `${name}: clean baseline`,
  );

  assert.equal(
    decorated.status,
    "PARSED",
    `${name}: decorated status`,
  );

  assert.deepEqual(
    decorated.errors,
    [],
    `${name}: decorated errors`,
  );

  assert.deepEqual(
    canonical(decorated),
    canonical(clean),
    `${name}: semantics changed`,
  );

  assert.equal(
    decorated.items.length,
    expectedItems,
    `${name}: item count`,
  );

  assert.equal(
    total(decorated),
    expectedTotal,
    `${name}: total`,
  );

  console.log(`PASS ${name}`);
}

console.log(
  "PARSER_VERSION=" + PARSER_VERSION,
);

sameAsClean(
  "S33-01 leading Laos flag on rood-double",
  "รูดเบิ้ล 3000x3000",
  "🇱🇦 รูดเบิ้ล 3000×3000",
  20,
  60000,
);

sameAsClean(
  "S33-02 trailing Laos flag on multi-sweep",
  "รูด 1,6 บลก 1000",
  "รูด 1,6 บลก 1000 🇱🇦",
  72,
  76000,
);

sameAsClean(
  "S33-03 sender short-date after sweep",
  "รูด 4,9 บลก 1000",
  `รูด 4,9 บลก 1000

พี่เมย์ 07/09`,
  72,
  76000,
);

sameAsClean(
  "S33-04 repeated leading Laos flags",
  "รูดเบิ้ล 300",
  "🇱🇦🇱🇦 รูดเบิ้ล 300",
  20,
  6000,
);

for (const text of [
  "🇱🇦 รูด 4,8 ??? 500",
  "รูด 4,8 ??? 500 🇱🇦",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "REVIEW",
    `malformed sweep must fail closed: ${text}`,
  );

  assert.deepEqual(
    result.items,
    [],
    `malformed sweep emitted items: ${text}`,
  );
}

console.log(
  "PASS S33-SAFETY-01 malformed decorated sweeps remain REVIEW",
);

{
  const result =
    parseOrder("พี่เมย์ 07/09");

  assert.equal(
    result.status,
    "IGNORE",
    "sender short-date alone is metadata",
  );

  assert.deepEqual(
    result.items,
    [],
  );
}

console.log(
  "PASS S33-SAFETY-02 sender short-date alone remains metadata",
);

{
  const result =
    parseOrder("07/09");

  assert.notEqual(
    result.status,
    "IGNORE",
    "bare short date must not silently become metadata",
  );
}

console.log(
  "PASS S33-SAFETY-03 bare short date remains fail-closed",
);

{
  const result =
    parseOrder(
      "🇹🇭 รูดเบิ้ล 3000x3000",
    );

  assert.notEqual(
    result.status,
    "PARSED",
    "unconfirmed flag must not be normalized",
  );

  assert.deepEqual(
    result.items,
    [],
  );
}

console.log(
  "PASS S33-SAFETY-04 unconfirmed flag remains outside normalization",
);

for (const text of [
  "🇱🇦รวม 60",
  "🇱🇦ดอม1080",
  "ต่าย🇱🇦",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "IGNORE",
    `existing metadata changed: ${text}`,
  );

  assert.deepEqual(
    result.items,
    [],
  );
}

console.log(
  "PASS S33-SAFETY-05 existing Laos metadata unchanged",
);

console.log(
  "PASS: sweep metadata envelope v9.33",
);
