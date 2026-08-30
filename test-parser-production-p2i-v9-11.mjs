import assert from "node:assert/strict";
import {
  parseOrder,
} from "./src/lib/order-parser.mjs";

function canonical(result) {
  return (result.items || [])
    .map(
      (x) =>
        `${x.category}${x.code}=${Number(x.quantity)}`
    )
    .sort();
}

function total(result) {
  return (result.items || []).reduce(
    (sum, x) =>
      sum + Number(x.quantity || 0),
    0
  );
}

const expectedDoubleAB = [
  "A00=1000",
  "A11=1000",
  "A22=1000",
  "A33=1000",
  "A44=1000",
  "A55=1000",
  "A66=1000",
  "A77=1000",
  "A88=1000",
  "A99=1000",
  "B00=1000",
  "B11=1000",
  "B22=1000",
  "B33=1000",
  "B44=1000",
  "B55=1000",
  "B66=1000",
  "B77=1000",
  "B88=1000",
  "B99=1000",
].sort();

// ------------------------------------------------------------
// P2I-01
// Exact production form.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "เพิ่มรูดเบิ้ล 1000 บล"
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 20);
  assert.equal(total(result), 20000);

  assert.deepEqual(
    canonical(result),
    expectedDoubleAB
  );

  assert.equal(
    result.rule_ids.includes(
      "R_SWEEP_DOUBLE_SET"
    ),
    true
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);

  console.log(
    "PASS P2I-01 production เพิ่มรูดเบิ้ล"
  );
}

// ------------------------------------------------------------
// P2I-02
// Optional whitespace after operational prefix.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "เพิ่ม รูดเบิ้ล 1000 บล"
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 20);
  assert.equal(total(result), 20000);

  assert.deepEqual(
    canonical(result),
    expectedDoubleAB
  );

  console.log(
    "PASS P2I-02 spaced operational prefix"
  );
}

// ------------------------------------------------------------
// P2I-SAFETY-01
// Existing baseline is unchanged.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "รูดเบิ้ล 1000 บล"
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 20);
  assert.equal(total(result), 20000);

  assert.deepEqual(
    canonical(result),
    expectedDoubleAB
  );

  console.log(
    "PASS P2I-SAFETY-01 baseline unchanged"
  );
}

// ------------------------------------------------------------
// P2I-SAFETY-02
// Ordinary เพิ่ม prose remains harmless.
// ------------------------------------------------------------
for (const text of [
  "เพิ่มรายการให้หน่อย",
  "เพิ่มยอดให้พี่",
  "เพิ่มคนส่ง",
  "เพิ่มอะไร 1000 บล",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "IGNORE",
    text
  );

  assert.equal(
    result.items.length,
    0,
    text
  );
}

console.log(
  "PASS P2I-SAFETY-02 ordinary เพิ่ม prose remains IGNORE"
);

// ------------------------------------------------------------
// P2I-SAFETY-03
// Do not generalize operational prefix beyond confirmed
// "รูดเบิ้ล" semantics.
// ------------------------------------------------------------
for (const text of [
  "เพิ่มรูด 7 = 500 บล",
  "เพิ่มเบิ้ล 1000 บล",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "REVIEW",
    text
  );

  assert.equal(
    result.items.length,
    0,
    text
  );
}

console.log(
  "PASS P2I-SAFETY-03 prefix scope remains narrow"
);

console.log(
  "PASS: production parser P2I operational prefix regression v9.11"
);
