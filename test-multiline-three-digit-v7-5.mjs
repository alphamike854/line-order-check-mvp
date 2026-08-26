import assert from "node:assert/strict";
import { parseOrder, PARSER_VERSION } from "./src/lib/order-parser.mjs";

function total(result) {
  return result.items.reduce((sum, item) => sum + item.quantity, 0);
}

function itemMap(result) {
  return Object.fromEntries(result.items.map((item) => [`${item.category}${item.code}`, item.quantity]));
}

// User regression: multiple 3-digit seeds on one line, quantity/permutation command on next line.
{
  const result = parseOrder(`397 349 796 106 072\n=50*6 ก`);
  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 30);
  assert.equal(total(result), 1500);
  for (const code of ["397","379","937","973","739","793"]) {
    assert.equal(itemMap(result)[`E${code}`], 50);
  }
  assert.ok(result.rule_ids.includes("R_3DIGIT_COUNTED_PERMUTE"));
}

// Count marker must match the actual number of unique permutations for every seed.
{
  const result = parseOrder(`998\n=50*6 ก`);
  assert.equal(result.status, "REVIEW");
  assert.ok(result.errors.some((error) => error.code === "PERMUTATION_COUNT_MISMATCH"));
}

// Previous pending regression: 3-digit pending lines + dash quantity and fast 2-digit modifier+qty forms.
{
  const result = parseOrder(`396\n394\n364\n964-10*10\n39/36//94/64/34 บลก 10\n96 บลก 20`);
  assert.equal(result.status, "PARSED");
  assert.equal(total(result), 360);
  const map = itemMap(result);
  for (const code of ["396","394","364","964"]) {
    assert.equal(map[`E${code}`], 10);
    assert.equal(map[`F${code}`], 10);
  }
  assert.equal(map.A39, 10);
  assert.equal(map.B93, 10);
  assert.equal(map.A96, 20);
  assert.equal(map.B69, 20);
}

// Existing multi-code E/F pair remains unchanged.
{
  const result = parseOrder(`920,202,707,101=500x500`);
  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 8);
  assert.equal(total(result), 4000);
}

// Unknown but strongly order-like syntax must be routed to Review, never disappear as IGNORE.
{
  const result = parseOrder(`397 349\n=foo`);
  assert.equal(result.status, "REVIEW");
  assert.ok(result.errors.some((error) => error.code === "UNRECOGNIZED_ORDER_SYNTAX"));
}

assert.ok(PARSER_VERSION.startsWith("1.3."));
console.log("PASS: multiline 3-digit + counted permutation + no-silent-ignore v7.5 smoke tests");
