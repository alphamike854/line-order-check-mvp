import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

assert.equal(
  PARSER_VERSION,
  "1.7.29",
  "v9.36 parser version",
);

function canonical(result) {
  return [...(result.items ?? [])]
    .map((x) => ({
      category: x.category,
      code: x.code,
      quantity: Number(x.quantity),
    }))
    .sort((a, b) =>
      `${a.category}${a.code}:${a.quantity}`
        .localeCompare(
          `${b.category}${b.code}:${b.quantity}`,
        ),
    );
}

function sameAsClean(
  name,
  decoratedText,
  cleanText,
) {
  const decorated = parseOrder(decoratedText);
  const clean = parseOrder(cleanText);

  assert.equal(
    decorated.status,
    clean.status,
    `${name}: status`,
  );

  assert.deepEqual(
    canonical(decorated),
    canonical(clean),
    `${name}: effective items`,
  );

  console.log(`PASS ${name}`);
}


// ------------------------------------------------------------
// Production incidents: Thai textual dates must disappear before
// any 2-digit / reverse / quantity grammar sees their numbers.
// ------------------------------------------------------------

sameAsClean(
  "DATE36-01 spaced Thai month + Buddhist year",
  `ลาว 23 ก ย. 2569
32 - 30 x 30
23 - 30 x 30
79 - 10 x 10
97 - 10 x 10
11 - 10 x 10
180 บาท`,
  `32 - 30 x 30
23 - 30 x 30
79 - 10 x 10
97 - 10 x 10
11 - 10 x 10
180 บาท`,
);

sameAsClean(
  "DATE36-02 Thai month + dash YY",
  `23 ก.ย-67 ลาว
537-20x20
37-30x30
73-30x30
160 ค้าง
ป้าตุ่น`,
  `537-20x20
37-30x30
73-30x30
160 ค้าง
ป้าตุ่น`,
);

sameAsClean(
  "DATE36-03 numeric full date + Laos suffix",
  `บน โต๊ด
079=20x20

บน ล่าง
79=20x20
97=20x20
03=20x20
30=20x20

200฿
23-9-69ลาว`,
  `บน โต๊ด
079=20x20

บน ล่าง
79=20x20
97=20x20
03=20x20
30=20x20

200฿`,
);

sameAsClean(
  "DATE36-04 dotted Thai month + dash YY",
  `23 ก.ย-69 ลาว
496-20
469-20
59
95 20x20
56
65
(200) พี่แฟรง`,
  `496-20
469-20
59
95 20x20
56
65
(200) พี่แฟรง`,
);

sameAsClean(
  "DATE36-05 dotted Thai month + spaced YY",
  `23 ก.ย. 67 ลาว
276
76
67 10x10
62
26
แม่เตี้ย
(100) จ่ายสด`,
  `276
76
67 10x10
62
26
แม่เตี้ย
(100) จ่ายสด`,
);


// ------------------------------------------------------------
// Standalone noise policy confirmed by operator.
// ------------------------------------------------------------

for (const text of [
  "ก",
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
  "ก ย.",
  "กย",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "IGNORE",
    `standalone metadata must ignore: ${text}`,
  );

  assert.deepEqual(
    result.items,
    [],
    `standalone metadata emitted items: ${text}`,
  );
}

console.log(
  "PASS DATE36-06 standalone ก / Thai month metadata",
);


// ------------------------------------------------------------
// Safety: known order uses of ก remain authoritative.
// Existing parser suites additionally cover these grammars.
// ------------------------------------------------------------

for (const text of [
  "848=40*3ก",
  "231.120.230=120*6ก",
  `39/36//94/64/34 บลก 10
96 บลก 20`,
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    `order ก grammar changed: ${text}`,
  );

  assert.ok(
    result.items.length > 0,
    `order ก grammar emitted no items: ${text}`,
  );
}

console.log(
  "PASS DATE36-SAFETY-01 3ก / 6ก / บลก preserved",
);


// ------------------------------------------------------------
// Safety: real codes 23 / 32 remain real orders.
// ------------------------------------------------------------

{
  const result = parseOrder(
    `บน-ล่าง
23=100*100
32=100*100`,
  );

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      { category: "A", code: "23", quantity: 100 },
      { category: "A", code: "32", quantity: 100 },
      { category: "B", code: "23", quantity: 100 },
      { category: "B", code: "32", quantity: 100 },
    ],
  );
}

{
  const result =
    parseOrder("23=300*300");

  assert.equal(result.status, "PARSED");

  assert.deepEqual(
    canonical(result),
    [
      { category: "A", code: "23", quantity: 300 },
      { category: "B", code: "23", quantity: 300 },
    ],
  );
}

console.log(
  "PASS DATE36-SAFETY-02 real 23/32 orders preserved",
);


// ------------------------------------------------------------
// Existing ambiguity boundaries remain unchanged.
// ------------------------------------------------------------

{
  const result =
    parseOrder("07/09");

  assert.notEqual(
    result.status,
    "IGNORE",
    "bare short slash date must remain fail-closed",
  );

  assert.deepEqual(result.items, []);
}

{
  const result =
    parseOrder("พี่เมย์ 07/09");

  assert.equal(result.status, "IGNORE");
  assert.deepEqual(result.items, []);
}

{
  const result =
    parseOrder("22-10-10");

  // Operator policy:
  // Date-looking numeric text without a confirmed order quantity
  // is ambiguous and must be sent to Human Review.
  assert.equal(
    result.status,
    "REVIEW",
    "22-10-10 without confirmed order quantity must enter Review",
  );

  assert.deepEqual(
    result.items,
    [],
    "22-10-10 must not emit speculative order items",
  );
}

for (const text of [
  "27-08-69",
  "27/8/26",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "IGNORE",
    `existing full date changed: ${text}`,
  );
}

console.log(
  "PASS DATE36-SAFETY-03 existing date ambiguity boundaries preserved",
);

console.log(
  "PASS: Thai date metadata boundary v9.36",
);
