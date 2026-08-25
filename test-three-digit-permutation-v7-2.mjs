import assert from "node:assert/strict";
import { parseOrder, PARSER_VERSION } from "./src/lib/order-parser.mjs";
import { validateCategoryAlias } from "./src/lib/settings-validation.mjs";

function itemMap(result) {
  return Object.fromEntries(result.items.map((x) => [`${x.category}${x.code}`, x.quantity]));
}
function total(result) {
  return result.items.reduce((sum, x) => sum + Number(x.quantity || 0), 0);
}

assert.ok(PARSER_VERSION.startsWith("1.3."));

// Authoritative example: each source code expands to all UNIQUE permutations.
const mixed = parseOrder("093  998 =  100 *  ทุกกลับ");
assert.equal(mixed.status, "PARSED");
assert.equal(mixed.items.length, 9); // 093 => 6, 998 => 3
assert.equal(total(mixed), 900);
for (const code of ["093", "039", "903", "930", "309", "390", "998", "989", "899"]) {
  assert.equal(itemMap(mixed)[`E${code}`], 100);
}
assert.ok(mixed.rule_ids.includes("R_3DIGIT_PERMUTE_ALL"));

// 3ปต / 3ประตู and 6ปต / 6ประตู are command aliases, while the actual
// unique-permutation count is derived from the digits (6 / 3 / 1).
for (const text of ["998=100 3ปต", "998=100 3ประตู", "998=100 6ปต", "998=100 6 ประตู"]) {
  const result = parseOrder(text);
  assert.equal(result.status, "PARSED", text);
  assert.equal(result.items.length, 3, text);
  assert.equal(total(result), 300, text);
}
for (const text of ["093=100 3ปต", "093=100 6ปต", "093=100 6 ประตู"]) {
  const result = parseOrder(text);
  assert.equal(result.status, "PARSED", text);
  assert.equal(result.items.length, 6, text);
  assert.equal(total(result), 600, text);
}
const allSame = parseOrder("111=100 ทุกกลับ");
assert.equal(allSame.status, "PARSED");
assert.equal(allSame.items.length, 1);
assert.equal(total(allSame), 100);

// Existing compact count syntax remains intact.
assert.equal(total(parseOrder("123=20x6")), 120);
assert.equal(total(parseOrder("122=20x3")), 60);

// Existing multi-code E/F quantity pair must not be reinterpreted as permutations.
const pair = parseOrder("920,202,707,101=500x500");
assert.equal(pair.status, "PARSED");
assert.equal(pair.items.length, 8);
assert.equal(total(pair), 4000);

// v7.2's temporary x* composite interpretation was corrected in v7.3.
// Keep this regression here so the old accidental grammar never becomes valid again.
const retiredXStar = parseOrder("998=100x100x*100");
assert.equal(retiredXStar.status, "REVIEW");
assert.equal(retiredXStar.items.length, 0);
assert.ok(retiredXStar.errors.some((x) => x.code === "INVALID_XSTAR_PERMUTATION"));

// Custom Settings aliases can target the same command.
assert.equal(
  validateCategoryAlias({ alias: "วนครบ", canonical_category: "PERMUTE_ALL" }).canonical_category,
  "PERMUTE_ALL"
);
const custom = parseOrder("998=50 วนครบ", { aliases: { "วนครบ": "PERMUTE_ALL" } });
assert.equal(custom.status, "PARSED");
assert.equal(custom.items.length, 3);
assert.equal(total(custom), 150);

console.log("PASS: 3-digit ทุกกลับ / ประตู permutation parser v7.2 smoke tests");
