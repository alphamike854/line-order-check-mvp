import assert from "node:assert/strict";
import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

function byKey(result) {
  return Object.fromEntries(
    result.items.map(item => [
      `${item.category}${item.code}`,
      item.quantity
    ])
  );
}

assert.equal(PARSER_VERSION, "1.7.0");

// ------------------------------------------------------------
// Production bug:
// 01 must NOT become quantity=1.
// 96:300/300 is a valid A/B pair.
// 10 and 01 remain unresolved -> PARTIAL.
// ------------------------------------------------------------
{
  const result = parseOrder(`69
96:300/300
10
01`);

  assert.equal(result.status, "PARTIAL");

  assert.deepEqual(byKey(result), {
    A69: 300,
    A96: 300,
    B69: 300,
    B96: 300,
  });

  assert.ok(
    result.errors.some(
      error =>
        error.code === "PENDING_CODES_WITHOUT_QUANTITY" &&
        String(error.detail).includes("10") &&
        String(error.detail).includes("01")
    ),
    "10 and 01 must remain pending"
  );

  assert.ok(
    result.rule_ids.includes("R_COLON_QUANTITY_PAIR"),
    "96:300/300 must use colon-pair grammar"
  );

  assert.ok(
    !result.rule_ids.includes("R_STANDALONE_QUANTITY"),
    "01 must not be interpreted as standalone quantity"
  );
}

// ------------------------------------------------------------
// Existing unambiguous colon pair remains valid.
// ------------------------------------------------------------
{
  const result = parseOrder(`10
01
33:200:200`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(byKey(result), {
    A01: 200,
    A10: 200,
    A33: 200,
    B01: 200,
    B10: 200,
    B33: 200,
  });
}

// ------------------------------------------------------------
// Existing slash quantity shorthand remains valid.
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

// ------------------------------------------------------------
// A 3+ digit standalone quantity remains unambiguous.
// ------------------------------------------------------------
{
  const result = parseOrder(`10
100`);

  assert.equal(result.status, "PARSED");

  assert.deepEqual(byKey(result), {
    A10: 100,
  });

  assert.ok(result.rule_ids.includes("R_STANDALONE_QUANTITY"));
}

// ------------------------------------------------------------
// Bare 2-digit final token is ambiguous.
// Better Review than silently create a wrong canonical quantity.
// ------------------------------------------------------------
{
  const result = parseOrder(`10
20`);

  assert.notEqual(result.status, "PARSED");

  assert.ok(
    result.errors.some(
      error => error.code === "PENDING_CODES_WITHOUT_QUANTITY"
    )
  );

  assert.equal(result.items.length, 0);
}

console.log(
  "PASS: ambiguous 2-digit quantity safety + colon slash pair v8.7"
);
