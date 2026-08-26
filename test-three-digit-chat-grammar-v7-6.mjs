import assert from "node:assert/strict";
import { parseOrder, PARSER_VERSION } from "./src/lib/order-parser.mjs";

function total(result) {
  return result.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}
function itemMap(result) {
  return Object.fromEntries(result.items.map((item) => [`${item.category}${item.code}`, item.quantity]));
}

// Production regression: dot-separated 3-digit seeds + attached count/reverse marker.
{
  const result = parseOrder("231.120.230=120*6ก");
  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 18);
  assert.equal(total(result), 2160);
  assert.ok(result.rule_ids.includes("R_3DIGIT_COUNTED_PERMUTE"));
  assert.equal(itemMap(result).E231, 120);
  assert.equal(itemMap(result).E312, 120);
  assert.equal(itemMap(result).E120, 120);
  assert.equal(itemMap(result).E021, 120);
  assert.equal(itemMap(result).E230, 120);
  assert.equal(itemMap(result).E032, 120);
}

// Natural F-category suffix: โต๊ด means F.
for (const [text, key] of [["639 100 โต๊ด", "F639"], ["731 100 โต๊ด", "F731"]]) {
  const result = parseOrder(text);
  assert.equal(result.status, "PARSED", text);
  assert.equal(result.items.length, 1, text);
  assert.equal(total(result), 100, text);
  assert.equal(itemMap(result)[key], 100, text);
}

// Natural permutation phrase; หกกลับ and 6กลับ mean the same command.
for (const text of ["812 หกกลับ 20", "812 6กลับ 20", "812 หก กลับ 20", "812 6 กลับ 20"]) {
  const result = parseOrder(text);
  assert.equal(result.status, "PARSED", text);
  assert.equal(result.items.length, 6, text);
  assert.equal(total(result), 120, text);
  assert.equal(itemMap(result).E812, 20, text);
  assert.equal(itemMap(result).E128, 20, text);
}

// Existing E/F pair grammar must remain intact.
{
  const result = parseOrder("920,202,707,101=500x500");
  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 8);
  assert.equal(total(result), 4000);
}

assert.ok(PARSER_VERSION.startsWith("1."));
console.log("PASS: dot-list + โต๊ด + หกกลับ 3-digit grammar v7.6 smoke tests");
