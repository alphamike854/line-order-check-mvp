import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

assert.equal(PARSER_VERSION, "1.7.23");

function map(result) {
  return Object.fromEntries(
    result.items.map((item) => [
      `${item.category}${item.code}`,
      Number(item.quantity),
    ]),
  );
}

function total(result) {
  return result.items.reduce(
    (sum, item) =>
      sum + Number(item.quantity || 0),
    0,
  );
}

function parsed(label, text) {
  const r = parseOrder(text);

  assert.equal(
    r.status,
    "PARSED",
    `${label}: ${JSON.stringify(r.errors)}`,
  );

  return r;
}

// ------------------------------------------------------------
// CR32-01
// รูด ไม่มี modifier = บลก
// ------------------------------------------------------------
{
  const r = parsed(
    "CR32-01",
    "รูด 4=100",
  );

  const m = map(r);

  assert.equal(r.items.length, 38);
  assert.equal(total(r), 3800);

  assert.equal(m.A40, 100);
  assert.equal(m.A04, 100);
  assert.equal(m.A44, 100);
  assert.equal(m.A94, 100);

  assert.equal(m.B40, 100);
  assert.equal(m.B04, 100);
  assert.equal(m.B94, 100);

  assert.ok(
    r.rule_ids.includes("R_REVERSE"),
  );

  console.log(
    "PASS CR32-01 bare รูด = บลก",
  );
}

// ------------------------------------------------------------
// CR32-02
// แม้เขียน บล รูดก็ยังหมายถึง 19 ตัว
// ------------------------------------------------------------
{
  const r = parsed(
    "CR32-02",
    "รูด 4=100 บล",
  );

  assert.equal(r.items.length, 38);
  assert.equal(total(r), 3800);

  console.log(
    "PASS CR32-02 รูด บล = 19-code sweep",
  );
}

// ------------------------------------------------------------
// CR32-03
// ไม่เอาเบิ้ล ตัด 44 ออก
// ------------------------------------------------------------
{
  const r = parsed(
    "CR32-03",
    "รูด 4=100 ไม่เอาเบิ้ล",
  );

  const m = map(r);

  assert.equal(r.items.length, 36);
  assert.equal(total(r), 3600);

  assert.equal(m.A44, undefined);
  assert.equal(m.B44, undefined);

  assert.equal(m.A04, 100);
  assert.equal(m.B94, 100);

  console.log(
    "PASS CR32-03 exclude double",
  );
}

// ------------------------------------------------------------
// CR32-04
// ระบุล่าง => เฉพาะ B แต่ยังกลับ = 19 ตัว
// ------------------------------------------------------------
{
  const r = parsed(
    "CR32-04",
    "รูด 7 ล่าง 35฿",
  );

  const m = map(r);

  assert.equal(r.items.length, 19);
  assert.equal(total(r), 665);

  assert.equal(m.B70, 35);
  assert.equal(m.B07, 35);
  assert.equal(m.B77, 35);

  assert.equal(m.A70, undefined);
  assert.equal(m.A07, undefined);

  console.log(
    "PASS CR32-04 lower-only = 19 codes",
  );
}

// ------------------------------------------------------------
// CR32-05
// หลาย seed + overlap ต้องสะสม
// ------------------------------------------------------------
{
  const r = parsed(
    "CR32-05",
    "รูด 4,9=100",
  );

  const m = map(r);

  assert.equal(r.items.length, 72);
  assert.equal(total(r), 7600);

  assert.equal(m.A49, 200);
  assert.equal(m.B49, 200);
  assert.equal(m.A94, 200);
  assert.equal(m.B94, 200);

  console.log(
    "PASS CR32-05 overlap accumulation",
  );
}

// ------------------------------------------------------------
// CR32-06
// pair quantity => A/B + reverse
// ------------------------------------------------------------
{
  const r = parsed(
    "CR32-06",
    "รูด6=300*300",
  );

  const m = map(r);

  assert.equal(r.items.length, 38);
  assert.equal(total(r), 11400);

  assert.equal(m.A60, 300);
  assert.equal(m.A06, 300);
  assert.equal(m.B69, 300);
  assert.equal(m.B96, 300);

  console.log(
    "PASS CR32-06 pair sweep",
  );
}

// ------------------------------------------------------------
// CR32-07
// รูดเบิ้ล default = AB
// ------------------------------------------------------------
{
  const r = parsed(
    "CR32-07",
    "รูดเบิ้ล 300",
  );

  const m = map(r);

  assert.equal(r.items.length, 20);
  assert.equal(total(r), 6000);

  assert.equal(m.A00, 300);
  assert.equal(m.A99, 300);
  assert.equal(m.B00, 300);
  assert.equal(m.B99, 300);

  console.log(
    "PASS CR32-07 bare รูดเบิ้ล = AB",
  );
}

// ------------------------------------------------------------
// CR32-08
// รูดเบิ้ล บล = รูดเบิ้ล AB
// ------------------------------------------------------------
{
  const thai = parsed(
    "CR32-08-thai",
    "รูดเบิ้ล 300 บล",
  );

  const canonical = parsed(
    "CR32-08-ab",
    "รูดเบิ้ล 300 AB",
  );

  assert.deepEqual(
    map(thai),
    map(canonical),
  );

  console.log(
    "PASS CR32-08 บล = AB",
  );
}

// ------------------------------------------------------------
// CR32-09
// รูดเบิ้ล + ไม่เอาเบิ้ล => ไม่เหลือรายการ
// ------------------------------------------------------------
{
  const r = parseOrder(
    "รูดเบิ้ล 300 บล ไม่เอาเบิ้ล",
  );

  assert.equal(r.status, "IGNORE");
  assert.equal(r.items.length, 0);
  assert.equal(total(r), 0);

  assert.ok(
    r.rule_ids.includes(
      "R_EXCLUDE_DOUBLE",
    ),
  );

  console.log(
    "PASS CR32-09 double set fully excluded",
  );
}

// ------------------------------------------------------------
// SAFETY
// ------------------------------------------------------------
{
  const r = parseOrder(
    "รูด 4,8 ??? 500",
  );

  assert.equal(r.status, "REVIEW");
  assert.equal(r.items.length, 0);

  console.log(
    "PASS CR32-SAFETY malformed remains REVIEW",
  );
}


// ------------------------------------------------------------
// CR32-SAFETY-02
// Bare "เบิ้ล" retains its established semantics.
// This rule change applies specifically to "รูดเบิ้ล".
// ------------------------------------------------------------
{
  const single =
    parsed(
      "CR32-SAFETY-02-single",
      "เบิ้ล 20",
    );

  const singleMap = map(single);

  assert.equal(single.items.length, 10);
  assert.equal(total(single), 200);

  assert.equal(singleMap.A00, 20);
  assert.equal(singleMap.A99, 20);
  assert.equal(singleMap.B00, undefined);
  assert.equal(singleMap.B99, undefined);

  const pair =
    parsed(
      "CR32-SAFETY-02-pair",
      "เบิ้ล 20*30",
    );

  const pairMap = map(pair);

  assert.equal(pair.items.length, 20);
  assert.equal(total(pair), 500);

  assert.equal(pairMap.A00, 20);
  assert.equal(pairMap.A99, 20);
  assert.equal(pairMap.B00, 30);
  assert.equal(pairMap.B99, 30);

  console.log(
    "PASS CR32-SAFETY-02 bare เบิ้ล semantics preserved",
  );
}

console.log(
  "PASS: Company Sweep Rule Contract v9.32",
);
