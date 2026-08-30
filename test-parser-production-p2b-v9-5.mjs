import assert from "node:assert/strict";
import {
  parseOrder,
} from "./src/lib/order-parser.mjs";

// ------------------------------------------------------------
// P2B-01 / semantics confirmed by P2I.
//
// Operational prefix "เพิ่ม" before รูดเบิ้ล is ignored and
// must resolve through the existing DOUBLE generator grammar.
// ------------------------------------------------------------
for (const text of [
  "เพิ่มรูดเบิ้ล 1000 บล",
  "เพิ่ม รูดเบิ้ล 1000 บล",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    text
  );

  assert.equal(
    result.items.length,
    20,
    text
  );

  assert.equal(
    result.items.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0),
      0
    ),
    20000,
    text
  );

  assert.equal(
    result.rule_ids.includes(
      "R_SWEEP_DOUBLE_SET"
    ),
    true,
    text
  );

  assert.equal(
    result.errors.length,
    0,
    text
  );

  assert.equal(
    result.warnings.length,
    0,
    text
  );
}

console.log(
  "PASS P2B-01 prefixed double generator safely recovered"
);

// ------------------------------------------------------------
// P2B-SAFETY-01
// Existing supported DOUBLE grammar remains unchanged.
// ------------------------------------------------------------
for (const text of [
  "รูดเบิ้ล 1000 บล",
  "เบิ้ล 1000 บล",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    text
  );

  assert.equal(
    result.items.length,
    20,
    text
  );

  assert.equal(
    result.errors.length,
    0,
    text
  );

  assert.equal(
    result.rule_ids.includes(
      "R_SWEEP_DOUBLE_SET"
    ),
    true,
    text
  );
}

console.log(
  "PASS P2B-SAFETY-01 supported double generators unchanged"
);

// ------------------------------------------------------------
// P2B-SAFETY-02
// Existing supported decade sweep grammar remains unchanged.
// ------------------------------------------------------------
for (const text of [
  "รูด 7 = 500 บล",
  "รูด6=300*300",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    text
  );

  assert.equal(
    result.items.length,
    20,
    text
  );

  assert.equal(
    result.errors.length,
    0,
    text
  );

  assert.equal(
    result.rule_ids.includes(
      "R_SWEEP_DECADE_SET"
    ),
    true,
    text
  );
}

console.log(
  "PASS P2B-SAFETY-02 supported decade sweep unchanged"
);

// ------------------------------------------------------------
// P2B-SAFETY-03
// Ordinary prose containing "เพิ่ม" must remain harmless.
// ------------------------------------------------------------
for (const text of [
  "เพิ่มรายการให้หน่อย",
  "เพิ่มยอดให้พี่",
  "เพิ่มคนส่ง",
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
  "PASS P2B-SAFETY-03 ordinary เพิ่ม prose remains IGNORE"
);

console.log(
  "PASS: production parser P2B regression v9.5"
);
