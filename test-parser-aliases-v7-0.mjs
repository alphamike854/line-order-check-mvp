import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";
import { validateCategoryAlias } from "./src/lib/settings-validation.mjs";

function map(result) {
  return Object.fromEntries(result.items.map((x) => [`${x.category}${x.code}`, x.quantity]));
}
function total(result) {
  return result.items.reduce((sum, x) => sum + Number(x.quantity || 0), 0);
}

// Regression: multiple 3-digit codes with an E/F quantity pair must not be dropped.
const mixed = parseOrder(`30,03,26,62,29,92=1000x1000
920,202,707,101=500x500
15,51,66,99,20,02=1000x1000`);
assert.equal(mixed.status, "PARSED");
assert.equal(total(mixed), 28000);
for (const code of ["920", "202", "707", "101"]) {
  assert.equal(map(mixed)[`E${code}`], 500);
  assert.equal(map(mixed)[`F${code}`], 500);
}

// C aliases act as reverse modifiers and can attach to AB for fast typing.
const reverse = parseOrder("ABกลับ 15 24=20", { aliases: { "กลับ": "C" } });
assert.deepEqual(map(reverse), {
  A15:20,A24:20,A42:20,A51:20,
  B15:20,B24:20,B42:20,B51:20,
});

// D aliases preserve the following decade digit.
const decade = parseOrder("สิบ5 AB=20", { aliases: { "สิบ": "D" } });
assert.equal(decade.status, "PARSED");
assert.equal(total(decade), 400);
assert.equal(map(decade).A50, 20);
assert.equal(map(decade).A59, 20);
assert.equal(map(decade).B50, 20);
assert.equal(map(decade).B59, 20);

// G aliases are canonical 3-digit G category aliases.
const g = parseOrder("สามล่าง 001,002=20", { aliases: { "สามล่าง": "G" } });
assert.deepEqual(map(g), { G001:20, G002:20 });

// DOUBLE aliases are separate from canonical 3-digit G.
const doubles = parseOrder("เบิ้ล=20 AB", { aliases: { "เบิ้ล": "DOUBLE" } });
assert.equal(total(doubles), 400);
assert.equal(map(doubles).A00, 20);
assert.equal(map(doubles).A99, 20);
assert.equal(map(doubles).B00, 20);
assert.equal(map(doubles).B99, 20);

// E/F aliases now work in 3-digit input too.
assert.deepEqual(map(parseOrder("สามบน 920,202=500", { aliases: { "สามบน": "E" } })), { E202:500, E920:500 });
assert.deepEqual(map(parseOrder("สามรอง 920,202=500", { aliases: { "สามรอง": "F" } })), { F202:500, F920:500 });

// Settings accepts all parser targets but rejects numeric-only aliases.
for (const target of ["A","B","C","D","E","F","G","DOUBLE"]) {
  assert.equal(validateCategoryAlias({ alias: `alias-${target}`, canonical_category: target }).canonical_category, target);
}
assert.throws(() => validateCategoryAlias({ alias: "11", canonical_category: "C" }), /INVALID_ALIAS/);
assert.throws(() => validateCategoryAlias({ alias: "x", canonical_category: "UNKNOWN" }), /INVALID_ALIAS_TARGET/);

console.log("PASS: Parser aliases C/D/G/DOUBLE + multi-3-digit pair v7.0 smoke tests");
