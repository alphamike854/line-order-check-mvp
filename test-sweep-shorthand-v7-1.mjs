import assert from "node:assert/strict";
import { parseOrder, PARSER_VERSION } from "./src/lib/order-parser.mjs";
import { validateCategoryAlias } from "./src/lib/settings-validation.mjs";

function map(result) {
  return Object.fromEntries(result.items.map((x) => [`${x.category}${x.code}`, x.quantity]));
}
function total(result) {
  return result.items.reduce((sum, x) => sum + Number(x.quantity || 0), 0);
}

assert.equal(PARSER_VERSION, "1.2.0");

// Composite operational shorthand: บล = AB, ก = reverse, บลก = ABC.
const composite = parseOrder(`08 09
45 65
= 250 บลก`);
assert.equal(composite.status, "PARSED");
assert.equal(composite.items.length, 16);
assert.equal(total(composite), 4000);
for (const code of ["08", "09", "45", "65", "80", "90", "54", "56"]) {
  assert.equal(map(composite)[`A${code}`], 250);
  assert.equal(map(composite)[`B${code}`], 250);
}

// รูด 1 => 10..19; บล => both A/B.
const sweep = parseOrder("รูด 1-300 บล");
assert.equal(sweep.status, "PARSED");
assert.equal(sweep.items.length, 20);
assert.equal(total(sweep), 6000);
for (let i = 0; i <= 9; i += 1) {
  assert.equal(map(sweep)[`A1${i}`], 300);
  assert.equal(map(sweep)[`B1${i}`], 300);
}

// Adding ก reverses codes, deduplicating self-reversing 11.
const sweepReverse = parseOrder("รูด 1-300 บลก");
assert.equal(sweepReverse.status, "PARSED");
assert.equal(sweepReverse.items.length, 38); // 19 unique codes x A/B
assert.equal(total(sweepReverse), 11400);
assert.equal(map(sweepReverse).A10, 300);
assert.equal(map(sweepReverse).A01, 300);
assert.equal(map(sweepReverse).B91, 300);
assert.equal(map(sweepReverse).B11, 300);

// Authoritative business example: exclude doubles after generating + reversing.
const noDouble = parseOrder("รูด 0-500 บลก (ไม่เอาเบิ้ล)");
assert.equal(noDouble.status, "PARSED");
assert.equal(noDouble.items.length, 36); // 18 unique non-double codes x A/B
assert.equal(total(noDouble), 18000);
assert.equal(map(noDouble).A01, 500);
assert.equal(map(noDouble).A09, 500);
assert.equal(map(noDouble).A10, 500);
assert.equal(map(noDouble).B90, 500);
assert.equal(map(noDouble).A00, undefined);
assert.equal(map(noDouble).B00, undefined);
assert.ok(noDouble.rule_ids.includes("R_EXCLUDE_DOUBLE"));

// รูดเบิ้ล => 00,11,...99.
const doubles = parseOrder("รูดเบิ้ล 300 บล");
assert.equal(doubles.status, "PARSED");
assert.equal(doubles.items.length, 20);
assert.equal(total(doubles), 6000);
for (let i = 0; i <= 9; i += 1) {
  assert.equal(map(doubles)[`A${i}${i}`], 300);
  assert.equal(map(doubles)[`B${i}${i}`], 300);
}

// Composite alias targets are configurable from Settings too.
for (const target of ["AB", "ABC"]) {
  assert.equal(validateCategoryAlias({ alias: `alias-${target}`, canonical_category: target }).canonical_category, target);
}
const configured = parseOrder("08 09=250 บนล่างกลับ", { aliases: { "บนล่างกลับ": "ABC" } });
assert.equal(configured.status, "PARSED");
assert.equal(total(configured), 2000); // 4 unique codes (08,09,80,90) x A/B x 250

console.log("PASS: Thai sweep shorthand + composite aliases v7.1 smoke tests");
