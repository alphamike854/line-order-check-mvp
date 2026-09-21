import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

function check(name, text) {
  const result = parseOrder(text);

  assert.notEqual(
    result.status,
    "IGNORE",
    `${name}: plausible order fragment must not silently become IGNORE`
  );

  assert.equal(
    result.items.length,
    0,
    `${name}: unsupported grammar must not invent canonical items`
  );

  console.log(
    `PASS ${name}: ${result.status}`
  );
}

check(
  "FRAGMENT-01 multiline 3-digit codes + ตัวละ pair",
  `487
233
ตัวละ5*5`
);

check(
  "FRAGMENT-02 multiline 3-digit codes + pair",
  `940
694
5*5`
);

{
  const result =
    parseOrder(
      `000-111-222-333-444-555-666-777-888-999
=20 ตรง`
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    result.items
      .map(
        item =>
          `${item.category}${item.code}=${item.quantity}`
      )
      .sort(),
    [
      "E000=20",
      "E111=20",
      "E222=20",
      "E333=20",
      "E444=20",
      "E555=20",
      "E666=20",
      "E777=20",
      "E888=20",
      "E999=20",
    ].sort()
  );

  assert.equal(
    result.errors.length,
    0
  );

  console.log(
    "PASS FRAGMENT-03 long 3-digit list + ตรง"
  );
}

console.log(
  "PASS: unsupported fragments remain Review-safe; confirmed long 3-digit list parses"
);

{
  const result = parseOrder(`บน
193=50*50
913=50*50
542=50*50
154=50*50
522=50*50*50
891=20*20
บลก
52=50*50
22=100
91=50*50
13=50*50
54=20*20
42=20*20
ลาว`);

  assert.equal(
    result.status,
    "PARSED",
    "mixed valid block with repeated permutation must fully parse"
  );

  assert.equal(
    result.errors.length,
    0,
    "valid repeated permutation must not produce parser errors"
  );

  assert.ok(
    result.items.length > 3,
    "surrounding high-confidence items must remain preserved"
  );

  const byKey =
    Object.fromEntries(
      result.items.map(
        item => [
          `${item.category}${item.code}`,
          Number(item.quantity),
        ]
      )
    );

  for (const code of [
    "225",
    "252",
    "522",
  ]) {
    assert.equal(
      byKey[`E${code}`],
      50,
      `expected E${code}=50 from 522 repeated permutation`
    );
  }

  assert.ok(
    result.rule_ids.includes(
      "R_3DIGIT_REPEATED_PERMUTATION"
    )
  );

  console.log(
    "PASS FRAGMENT-04 mixed valid block accepts repeated permutation"
  );
}
