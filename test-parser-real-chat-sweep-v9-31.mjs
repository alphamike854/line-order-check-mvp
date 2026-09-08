import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

assert.equal(
  PARSER_VERSION,
  "1.7.22",
);

function map(result) {
  return Object.fromEntries(
    (result.items ?? []).map(
      (item) => [
        `${item.category}${item.code}`,
        Number(item.quantity),
      ],
    ),
  );
}

function total(result) {
  return (result.items ?? []).reduce(
    (sum, item) =>
      sum + Number(item.quantity || 0),
    0,
  );
}

function parsed(label, text) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    `${label}: expected PARSED, got ${result.status}\n`
      + `errors=${JSON.stringify(result.errors)}\n`
      + `warnings=${JSON.stringify(result.warnings)}`
  );

  return result;
}

// ------------------------------------------------------------
// GOLD-01
// Standalone "ไม่เอาเบิ้ล" belongs to the preceding sweep.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-01 standalone exclude-double",
    `รูด 8 - 1000 บล

ไม่เอาเบิ้ลค่ะ`
  );

  const m = map(r);

  assert.equal(r.items.length, 36);
  assert.equal(total(r), 36000);

  assert.equal(m.A80, 1000);
  assert.equal(m.B89, 1000);

  assert.equal(m.A88, undefined);
  assert.equal(m.B88, undefined);

  console.log(
    "PASS GOLD-01 standalone exclude-double"
  );
}

// ------------------------------------------------------------
// GOLD-02
// Modifier before equals/quantity + บาท.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-02 modifier before quantity",
    `ลาว 7/9/69

รูด 4 บล = 500 บาท

ไม่เอาเบิ้ลค่ะ`
  );

  const m = map(r);

  assert.equal(r.items.length, 36);
  assert.equal(total(r), 18000);

  assert.equal(m.A40, 500);
  assert.equal(m.B49, 500);

  assert.equal(m.A44, undefined);
  assert.equal(m.B44, undefined);

  console.log(
    "PASS GOLD-02 modifier before quantity"
  );
}

// ------------------------------------------------------------
// GOLD-03
// Multi-seed multiline sweep.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-03 multiline multi-sweep",
    `รูด 2,3
บลก
1000x1000`
  );

  const m = map(r);

  assert.equal(total(r), 76000);

  // Cross-sweep overlap accumulates.
  assert.equal(m.A23, 2000);
  assert.equal(m.B23, 2000);
  assert.equal(m.A32, 2000);
  assert.equal(m.B32, 2000);

  console.log(
    "PASS GOLD-03 multiline multi-sweep"
  );
}

// ------------------------------------------------------------
// GOLD-04 / 05
// DOUBLE modifier-before-quantity + multiline.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-04 double modifier before pair",
    "รูดเบิ้ล บล 500-500"
  );

  const m = map(r);

  assert.equal(r.items.length, 20);
  assert.equal(total(r), 10000);
  assert.equal(m.A00, 500);
  assert.equal(m.B99, 500);

  console.log(
    "PASS GOLD-04 double modifier before pair"
  );
}

{
  const r = parsed(
    "GOLD-05 multiline double",
    `รูดเบิ้ล
บล 2000x2000`
  );

  const m = map(r);

  assert.equal(r.items.length, 20);
  assert.equal(total(r), 40000);
  assert.equal(m.A11, 2000);
  assert.equal(m.B88, 2000);

  console.log(
    "PASS GOLD-05 multiline double"
  );
}

// ------------------------------------------------------------
// GOLD-06
// Generic comma multi-sweep: values must not affect grammar.
// ------------------------------------------------------------

for (const [label, text, quantity] of [
  [
    "4,8 200",
    "รูด 4,8 บลก 200x200",
    200,
  ],
  [
    "0,2 300",
    "รูด 0,2 บลก 300x300",
    300,
  ],
  [
    "1,3 500",
    "รูด 1,3 บลก 500x500",
    500,
  ],
  [
    "5,7 500",
    "รูด 5,7 บลก 500x500",
    500,
  ],
]) {
  const r = parsed(
    `GOLD-06 ${label}`,
    text
  );

  assert.equal(
    total(r),
    19 * 2 * quantity * 2
  );
}

console.log(
  "PASS GOLD-06 generic comma multi-sweep"
);

// ------------------------------------------------------------
// GOLD-07
// Multi-sweep pair: A/B quantity pair + inherent รูด reverse.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-07 pair defaults to A/B + reverse",
    "รูด 0,7=500*500"
  );

  const m = map(r);

  assert.equal(r.items.length, 72);
  assert.equal(total(r), 38000);

  assert.equal(m.A00, 500);
  assert.equal(m.B09, 500);
  assert.equal(m.A70, 1000);
  assert.equal(m.B79, 500);

  console.log(
    "PASS GOLD-07 pair defaults to A/B + reverse"
  );
}

// ------------------------------------------------------------
// GOLD-08
// Slash-separated sweep seeds + lower-only + currency suffix.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-08 slash seeds lower",
    "รูด 9/4 ล่าง5฿"
  );

  const m = map(r);

  assert.equal(r.items.length, 36);
  assert.equal(total(r), 190);

  assert.equal(m.B90, 5);
  assert.equal(m.B49, 10);

  assert.equal(m.A90, undefined);
  assert.equal(m.A49, undefined);

  console.log(
    "PASS GOLD-08 slash seeds lower"
  );
}

// ------------------------------------------------------------
// GOLD-09
// Hyphen between two one-digit seeds is multi-sweep only
// when modifier + separate quantity follows.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-09 compact hyphen multi-sweep",
    "รูด7-8บล100"
  );

  const m = map(r);

  assert.equal(r.items.length, 72);
  assert.equal(total(r), 7600);

  assert.equal(m.A70, 100);
  assert.equal(m.B79, 100);
  assert.equal(m.A80, 100);
  assert.equal(m.B89, 100);

  console.log(
    "PASS GOLD-09 compact hyphen multi-sweep"
  );
}

// ------------------------------------------------------------
// GOLD-10
// Compact DOUBLE modifier.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-10 compact double modifier",
    "รูดเบิ้ลบล 300"
  );

  const m = map(r);

  assert.equal(r.items.length, 20);
  assert.equal(total(r), 6000);
  assert.equal(m.A00, 300);
  assert.equal(m.B99, 300);

  console.log(
    "PASS GOLD-10 compact double modifier"
  );
}

// ------------------------------------------------------------
// GOLD-11
// Explicit 00-to-99 double wording + ordinary order.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-11 explicit double range",
    `รูดเบิ้ล 00 ถึง 99=50*50

22/66/77=50*50`
  );

  const m = map(r);

  assert.equal(total(r), 1300);

  // Double sweep 50 + explicit order 50.
  assert.equal(m.A22, 100);
  assert.equal(m.B22, 100);
  assert.equal(m.A66, 100);
  assert.equal(m.B77, 100);

  console.log(
    "PASS GOLD-11 explicit double range"
  );
}

// ------------------------------------------------------------
// GOLD-12
// Sweep plus explicit same-message codes.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-12 sweep plus explicit orders",
    `รูด 7 บลก 20
77=20*20

74/47/67/76/79/97=20*20`
  );

  const m = map(r);

  assert.equal(total(r), 1040);

  // 77 already exists in sweep and gets another 20.
  assert.equal(m.A77, 40);
  assert.equal(m.B77, 40);

  // Same for explicit codes already generated by sweep.
  assert.equal(m.A74, 40);
  assert.equal(m.B97, 40);

  console.log(
    "PASS GOLD-12 sweep plus explicit orders"
  );
}

// ------------------------------------------------------------
// GOLD-13
// Real compact two-seed message + following บลก block.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-13 compact sweep plus block",
    `รูด 4-8 บล5

48--49--41
89--81--91

บลก5`
  );

  assert.equal(total(r), 500);

  console.log(
    "PASS GOLD-13 compact sweep plus block"
  );
}

// ------------------------------------------------------------
// GOLD-14
// Authoritative business contract:
// each sweep is independent; overlap across sweeps accumulates.
// ------------------------------------------------------------

{
  const r = parsed(
    "GOLD-14 overlap accumulation",
    "รูด 4,9 บลก 1000"
  );

  const m = map(r);

  assert.equal(total(r), 76000);

  assert.equal(m.A49, 2000);
  assert.equal(m.B49, 2000);
  assert.equal(m.A94, 2000);
  assert.equal(m.B94, 2000);

  assert.equal(m.A40, 1000);
  assert.equal(m.A04, 1000);
  assert.equal(m.B90, 1000);
  assert.equal(m.B09, 1000);

  console.log(
    "PASS GOLD-14 overlap accumulation"
  );
}

// ------------------------------------------------------------
// SAFETY-01
// Existing single-sweep digit-quantity shorthand must not
// become a multi-seed sweep.
// ------------------------------------------------------------

{
  const r = parsed(
    "SAFETY-01 single sweep hyphen quantity",
    "รูด 8-5 บล"
  );

  const m = map(r);

  assert.equal(r.items.length, 38);
  assert.equal(total(r), 190);

  assert.equal(m.A80, 5);
  assert.equal(m.B89, 5);

  assert.equal(m.A50, undefined);
  assert.equal(m.B59, undefined);

  console.log(
    "PASS SAFETY-01 single sweep hyphen quantity"
  );
}

// ------------------------------------------------------------
// SAFETY-02
// Established equals pair now follows company 19-code sweep.
// ------------------------------------------------------------

{
  const r = parsed(
    "SAFETY-02 canonical sweep company rule",
    "รูด6=300*300"
  );

  const m = map(r);

  assert.equal(r.items.length, 38);
  assert.equal(total(r), 11400);
  assert.equal(m.A60, 300);
  assert.equal(m.B69, 300);

  console.log(
    "PASS SAFETY-02 canonical sweep company rule"
  );
}

// ------------------------------------------------------------
// SAFETY-03
// Unknown generator grammar remains fail-closed.
// ------------------------------------------------------------

{
  const r = parseOrder(
    "รูด 4,8 ??? 500"
  );

  assert.equal(
    r.status,
    "REVIEW"
  );

  assert.equal(
    r.items.length,
    0
  );

  console.log(
    "PASS SAFETY-03 malformed sweep remains REVIEW"
  );
}

console.log(
  "PASS: real-chat Sweep Grammar Gold Contract v9.31"
);
