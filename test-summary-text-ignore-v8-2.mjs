import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

function total(result) {
  return result.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

// Aggregate summary from a sender is not an order and must not enter Review.
{
  const result = parseOrder(
    "รวมตรง 1,140 | รวมวิ่ง 0 | รวมทั้งหมด 1,140"
  );

  assert.equal(result.status, "IGNORE");
  assert.equal(result.items.length, 0);
  assert.equal(result.errors.length, 0);
  assert.ok(
    !result.warnings.some(
      (warning) => warning.code === "UNRECOGNIZED_ORDER_LIKE_TEXT"
    )
  );
}

// Other obvious summary/report forms are ignored.
for (const text of [
  "สรุปยอดวันนี้ 5,600",
  "ยอดรวม 5,600",
  "รวมยอด 5,600",
  "ยอดปัจจุบัน 5,600",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "IGNORE",
    `expected IGNORE: ${text}`
  );
  assert.equal(result.items.length, 0);
  assert.equal(result.errors.length, 0);
}

// Ordinary conversation remains ignored.
{
  const result = parseOrder("รับทราบครับ");
  assert.equal(result.status, "IGNORE");
  assert.equal(result.items.length, 0);
}

// Real order syntax is unchanged.
{
  const result = parseOrder("01 02 03=20");

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 3);
  assert.equal(total(result), 60);
}

// A summary line following an actual order must not discard the order.
{
  const result = parseOrder(
    "01 02 03=20\nรวมตรง 60 | รวมทั้งหมด 60"
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 3);
  assert.equal(total(result), 60);
}

// No-silent-ignore safety must remain intact.
{
  const result = parseOrder("397 349\n=foo");

  assert.equal(result.status, "REVIEW");
  assert.ok(
    result.errors.some(
      (error) => error.code === "UNRECOGNIZED_ORDER_SYNTAX"
    )
  );
}

console.log(
  "PASS: summary/non-order text filtering + no-silent-ignore v8.2 smoke tests"
);
