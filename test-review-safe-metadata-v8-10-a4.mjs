import assert from "node:assert/strict";
import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

function canonical(result) {
  return [...result.items]
    .map((item) => ({
      category: item.category,
      code: item.code,
      quantity: Number(item.quantity),
    }))
    .sort((a, b) =>
      a.category.localeCompare(b.category) ||
      a.code.localeCompare(b.code) ||
      a.quantity - b.quantity
    );
}

assert.equal(PARSER_VERSION, "1.6.3");

// ------------------------------------------------------------
// Gold Review #335.
//
// Order semantics are already correct. The only difference
// between source and corrected text is trailing operational
// metadata:
//
//   2,400฿🇱🇦🇱🇦 พี่แอ๋ม
//
// Currency-first name metadata must not make a valid order
// PARTIAL/REVIEW.
// ------------------------------------------------------------
{
  const corrected = parseOrder(`บน-โต๊ด
507=200x1000
204=200x1000`);

  assert.equal(corrected.status, "PARSED");

  const source = parseOrder(`บน-โต๊ด
507=200×1000
204=200×1000

2,400฿🇱🇦🇱🇦  พี่แอ๋ม`);

  assert.equal(source.status, "PARSED");

  assert.deepEqual(
    canonical(source),
    canonical(corrected)
  );

  assert.deepEqual(
    source.errors,
    corrected.errors
  );
}

// Metadata by itself is not an order.
{
  const result = parseOrder(
    "2,400฿🇱🇦🇱🇦 พี่แอ๋ม"
  );

  assert.equal(result.status, "IGNORE");
  assert.equal(result.items.length, 0);
}

// SAFETY: known order language containing currency must not
// become metadata merely because a baht symbol is present.
{
  const result = parseOrder(
    "รูด 7 ล่าง 35฿"
  );

  assert.notEqual(
    result.status,
    "IGNORE",
    "order-language currency text must remain Review-safe"
  );
}

// SAFETY: '=' remains an order signal.
{
  const result = parseOrder("77=20฿");

  assert.notEqual(
    result.status,
    "IGNORE",
    "assignment-like text must not be hidden as metadata"
  );
}


// ------------------------------------------------------------
// SAFETY: Review #91.
//
// "รูด" is known order language. Until its exact shorthand
// semantics are explicitly supported, it must remain Review-safe
// rather than silently becoming IGNORE.
// ------------------------------------------------------------
{
  const result = parseOrder(`รูด 7 = 500 บ/ล
27-08-69`);

  assert.notEqual(
    result.status,
    "IGNORE",
    "known order command must never silently disappear"
  );

  assert.ok(
    result.status === "REVIEW" ||
    result.status === "PARTIAL",
    "unsupported รูด grammar should remain Review-safe"
  );
}

// ------------------------------------------------------------
// SAFETY: date-looking order ambiguity.
//
// 22-10-10 occurred in the Review corpus as an unresolved
// order-like expression. It must not be silently classified as
// historical date metadata.
//
// Current operational date styles using YY=26 or Thai YY=69
// must continue to be recognized as metadata.
// ------------------------------------------------------------
{
  const ambiguous = parseOrder("22-10-10");

  assert.notEqual(
    ambiguous.status,
    "IGNORE",
    "22-10-10 must remain ambiguous"
  );

  assert.equal(
    ambiguous.items.length,
    0
  );

  assert.equal(
    parseOrder("27-08-69").status,
    "IGNORE"
  );

  assert.equal(
    parseOrder("27/8/26").status,
    "IGNORE"
  );
}

console.log(
  "PASS: currency-first name metadata + order safety v8.10 A4"
);
