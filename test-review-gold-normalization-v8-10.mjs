import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

const cases = [
  {
    name: "date/name metadata after corrected order",
    raw: `บล
72 27
35 53
24 42
=500*500

27/8/69
K.dow`,
    corrected: `บล
72 27
35 53
24 42
=500*500`,
  },
  {
    name: "quantity prefix before paired code list",
    raw: `บล 5000×5000
05-50 38-83 56-65
79-97 58-85`,
    corrected: `บล
05-50 38-83 56-65
79-97 58-85
5000x5000`,
  },
  {
    name: "leading dash quantity after multiline codes",
    raw: `16
39
46
80
40
-500 บลก

พี่จ๋า`,
    corrected: `16
39
46
80
40
=500 บลก

พี่จ๋า`,
  },
  {
    name: "dash assignment on final code",
    raw: `60
35
42
68
31-300 บลก

K.cittie`,
    corrected: `60
35
42
68
31=300 บลก`,
  },
  {
    name: "direction quantity prefix before dash-separated code list",
    raw: `ล-บ 1500×1500
18-52-28-41-76
37-56-95-69-03`,
    corrected: `ล-บ
18-52-28-41-76
37-56-95-69-03
=1500x1500`,
  },
  {
    name: "leading dash pair quantity",
    raw: `36
63
32
23
-500*500 บล`,
    corrected: `36
63
32
23
=500*500 บล`,
  },
  {
    name: "inline dash assignment with several codes",
    raw: `40 16 93 91-500 บลก`,
    corrected: `40 16 93 91=500 บลก`,
  },
  {
    name: "leading dash quantity second multiline example",
    raw: `31
26
74
90
27
-300 บลก

Jj`,
    corrected: `31
26
74
90
27
=300 บลก`,
  },
  {
    name: "inline dash assignment second example",
    raw: `01 36 73 92 69-250 บลก`,
    corrected: `01 36 73 92 69=250 บลก`,
  },
];

const failures = [];

for (const testCase of cases) {
  const raw = parseOrder(testCase.raw);
  const corrected = parseOrder(testCase.corrected);

  assert.equal(
    corrected.status,
    "PARSED",
    `${testCase.name}: corrected gold text itself must remain PARSED`
  );

  const sameItems =
    JSON.stringify(raw.items) === JSON.stringify(corrected.items);

  if (raw.status !== "PARSED" || !sameItems) {
    failures.push({
      name: testCase.name,
      raw_status: raw.status,
      raw_errors: raw.errors.map((error) => error.code).join(","),
      corrected_items: corrected.items.length,
      raw_items: raw.items.length,
    });
  }
}

if (failures.length) {
  console.table(failures);
  throw new Error(
    `GOLD_REVIEW_NORMALIZATION_FAILED: ${failures.length}/${cases.length}`
  );
}

// ------------------------------------------------------------
// Safety: '-' is NOT globally converted to '='.
// ------------------------------------------------------------

{
  const result = parseOrder("05-50");

  assert.equal(
    result.items.length,
    0,
    "05-50 must remain an unresolved two-code list, not A05=50"
  );

  assert.ok(
    result.errors.some(
      (error) => error.code === "PENDING_CODES_WITHOUT_QUANTITY"
    ),
    "ambiguous dash-separated codes must stay Review-safe"
  );
}

// 3-digit dash syntax remains untouched in A1.
// Its business semantics will be handled separately in v1.6B.
{
  const result = parseOrder("593-50*50");

  assert.ok(
    !result.items.some((item) => item.code === "593"),
    "A1 must not invent 3-digit dash-assignment semantics"
  );
}

// Existing slash-pair safety must remain unchanged.
{
  const result = parseOrder(`07/70
500/500`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(result.items, [
    { category: "A", code: "07", quantity: 500 },
    { category: "A", code: "70", quantity: 500 },
    { category: "B", code: "07", quantity: 500 },
    { category: "B", code: "70", quantity: 500 },
  ]);
}

console.log(
  `PASS: ${cases.length} corrected Review gold examples normalize identically v8.10`
);
