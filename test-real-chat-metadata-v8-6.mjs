import assert from "node:assert/strict";
import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

function byKey(result) {
  return Object.fromEntries(
    result.items.map((item) => [
      `${item.category}${item.code}`,
      item.quantity,
    ])
  );
}

function total(result) {
  return result.items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );
}

assert.equal(PARSER_VERSION, "1.6.0");

// ------------------------------------------------------------
// Real chat: pending 2-digit codes + semicolon A/B quantity pair.
// ------------------------------------------------------------
{
  const result = parseOrder(`26
62
60
06:200;200`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.errors, []);

  assert.deepEqual(byKey(result), {
    A06: 200,
    A26: 200,
    A60: 200,
    A62: 200,
    B06: 200,
    B26: 200,
    B60: 200,
    B62: 200,
  });

  assert.equal(total(result), 1600);
  assert.ok(
    result.rule_ids.includes("R_COLON_QUANTITY_PAIR")
  );
}

// ------------------------------------------------------------
// Combined top/bottom context + slash-date metadata.
// Date must NOT create fake 26 / 69 order codes.
// ------------------------------------------------------------
{
  const result = parseOrder(`บนล่าง
64=1500*1500
46=1500*1500
68=1500*1500
86=1500*1500
ลาว 26/8/69`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.errors, []);

  assert.deepEqual(byKey(result), {
    A46: 1500,
    A64: 1500,
    A68: 1500,
    A86: 1500,
    B46: 1500,
    B64: 1500,
    B68: 1500,
    B86: 1500,
  });

  assert.equal(total(result), 12000);

  assert.ok(
    result.rule_ids.includes("R_2DIGIT_CONTEXT_TOP_BOTTOM")
  );

  assert.ok(!result.items.some(
    (item) => item.code === "26" || item.code === "69"
  ));
}

// ------------------------------------------------------------
// Existing hyphen date metadata must remain supported.
// ------------------------------------------------------------
{
  const result = parseOrder(`บนล่าง
64=100*100
ลาว 21-8-69`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(result.errors, []);

  assert.deepEqual(byKey(result), {
    A64: 100,
    B64: 100,
  });
}

// ------------------------------------------------------------
// Safety: slash quantities must NOT be globally ignored as dates.
// ------------------------------------------------------------
{
  const result = parseOrder(`07/70
500/500`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(byKey(result), {
    A07: 500,
    A70: 500,
    B07: 500,
    B70: 500,
  });
}

console.log(
  "PASS: semicolon quantity + บนล่าง + slash-date metadata v8.6"
);
