import assert from "node:assert/strict";
import { parseOrder, PARSER_VERSION } from "./src/lib/order-parser.mjs";

function byKey(result) {
  return Object.fromEntries(
    result.items.map((item) => [`${item.category}${item.code}`, item.quantity])
  );
}

function total(result) {
  return result.items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );
}

assert.ok(
  ["1.7.0", "1.7.1", "1.7.2", "1.7.3", "1.7.4", "1.7.5", "1.7.6", "1.7.7", "1.7.8", "1.7.9", "1.7.10", "1.7.11"].includes(PARSER_VERSION),
);

// Pending 2-digit codes completed by code:top:bottom.
{
  const result = parseOrder(`10
01
33:200:200`);

  assert.equal(result.status, "PARSED");
  assert.equal(result.errors.length, 0);

  const map = byKey(result);

  for (const code of ["10", "01", "33"]) {
    assert.equal(map[`A${code}`], 200);
    assert.equal(map[`B${code}`], 200);
  }

  assert.equal(total(result), 1200);
  assert.ok(result.rule_ids.includes("R_COLON_QUANTITY_PAIR"));
}

// 2-digit pending list followed by A/B slash quantities.
// 500/500 must NOT be stolen by the 3-digit coalescer here.
{
  const result = parseOrder(`07/70
500/500`);

  assert.equal(result.status, "PARSED");
  assert.equal(result.errors.length, 0);

  assert.deepEqual(byKey(result), {
    A07: 500,
    A70: 500,
    B07: 500,
    B70: 500,
  });

  assert.equal(total(result), 2000);
  assert.ok(result.rule_ids.includes("R_CONTEXTUAL_SLASH_QUANTITY"));
}

// Direction headers + code:quantity.
{
  const result = parseOrder(`บน
06: 200
60: 200

ล่าง
06: 200
60: 200`);

  assert.equal(result.status, "PARSED");
  assert.equal(result.errors.length, 0);

  assert.deepEqual(byKey(result), {
    A06: 200,
    A60: 200,
    B06: 200,
    B60: 200,
  });

  assert.equal(total(result), 800);
  assert.ok(result.rule_ids.includes("R_COLON_SINGLE_QUANTITY"));
  assert.ok(result.rule_ids.includes("R_2DIGIT_CONTEXT_TOP"));
  assert.ok(result.rule_ids.includes("R_2DIGIT_CONTEXT_BOTTOM"));
}

// Short contextual aliases continue to work with colon quantities.
{
  const result = parseOrder(`บ
06:200
ล
60:300`);

  assert.equal(result.status, "PARSED");
  assert.deepEqual(byKey(result), {
    A06: 200,
    B60: 300,
  });
}

// Operational totals are report text, not orders and not Review warnings.
for (const text of [
  "รวม 3 ตัวโต๊ด 530",
  "รวม 2 ตัวล่าง 1880",
]) {
  const result = parseOrder(text);

  assert.equal(result.status, "IGNORE", text);
  assert.equal(result.items.length, 0, text);
  assert.equal(result.errors.length, 0, text);
  assert.equal(result.warnings.length, 0, text);
}

console.log(
  "PASS: real-chat colon/slash shorthand + operational summaries v8.4"
);
