import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

function byKey(result) {
  return Object.fromEntries(
    result.items.map((item) => [
      `${item.category}${item.code}`,
      item.quantity,
    ])
  );
}

// ------------------------------------------------------------
// Review corpus:
// บน-ล่าง ตัวละ 30
// 44
// 35
// 53
// ------------------------------------------------------------
{
  const result = parseOrder(`บน-ล่าง ตัวละ 30
44
35
53`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(byKey(result), {
    A35: 30,
    A44: 30,
    A53: 30,
    B35: 30,
    B44: 30,
    B53: 30,
  });
}

// ------------------------------------------------------------
// Collective quantity after code block.
// ------------------------------------------------------------
{
  const result = parseOrder(`23
32
38
83
ตัวละ 500 บนล่าง`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(byKey(result), {
    A23: 500,
    A32: 500,
    A38: 500,
    A83: 500,
    B23: 500,
    B32: 500,
    B38: 500,
    B83: 500,
  });
}

// ------------------------------------------------------------
// One collective quantity can close explicit TOP/BOTTOM blocks.
// ------------------------------------------------------------
{
  const result = parseOrder(`บน
19
91
ล่าง
19
91

ตัวละ50`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(byKey(result), {
    A19: 50,
    A91: 50,
    B19: 50,
    B91: 50,
  });
}

// ------------------------------------------------------------
// Direction aliases found in real Review messages.
// ------------------------------------------------------------
{
  const result = parseOrder(`บน*ล่าง
72=30*30
27=30*30

พี่อีฟเบญ🇱🇦120฿`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(byKey(result), {
    A27: 30,
    A72: 30,
    B27: 30,
    B72: 30,
  });
}

{
  const result = parseOrder(`บ/ล
77=20*20
62=20*20`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(byKey(result), {
    A62: 20,
    A77: 20,
    B62: 20,
    B77: 20,
  });
}

// ------------------------------------------------------------
// Summary/payment metadata must not poison an otherwise valid order.
// ------------------------------------------------------------
{
  const result = parseOrder(`บน
80=100*100
ล่าง
80=100*100

รวม 400฿ พี่เมล์`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(byKey(result), {
    A80: 100,
    B80: 100,
  });
}

{
  const result = parseOrder(`77=15*15

ยอด30`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(byKey(result), {
    A77: 15,
    B77: 15,
  });
}

{
  const result = parseOrder(`ล่าง
44=50
46=50
55=50
45=80
54=80
310฿`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(byKey(result), {
    B44: 50,
    B45: 80,
    B46: 50,
    B54: 80,
    B55: 50,
  });
}

// ------------------------------------------------------------
// Safety: money notation inside an actual command is NOT metadata.
// ------------------------------------------------------------
{
  const result = parseOrder("รูด 7 ล่าง 35฿");

  assert.notEqual(
    result.status,
    "IGNORE",
    "order-like line with รูด/ล่าง must not be silently discarded"
  );
}

// ------------------------------------------------------------
// Safety: collective grammar remains 2-digit only.
// Do not invent meaning for 3-digit โต๊ด ตัวละ.
// ------------------------------------------------------------
{
  const result = parseOrder(`460
490
190
410
491

โต๊ด ตัวละ 150.-`);

  assert.ok(
    result.status === "REVIEW" || result.status === "PARTIAL",
    "3-digit collective โต๊ด semantics must remain Review-safe"
  );

  assert.equal(
    result.items.length,
    0,
    "A2 must not manufacture canonical 3-digit items"
  );
}

console.log(
  "PASS: Review collective quantity + direction aliases + safe metadata v8.10 A2"
);
