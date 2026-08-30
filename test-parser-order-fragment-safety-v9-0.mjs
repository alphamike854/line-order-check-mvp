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

check(
  "FRAGMENT-03 dash-separated 3-digit list + quantity",
  `000-111-222-333-444-555-666-777-888-999
=20 ตรง`
);

console.log(
  "PASS: unsupported 3-digit order fragments remain Review-safe"
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

  for (const code of [
    "225",
    "252",
    "522",
  ]) {
    assert.equal(
      result.items.some(
        item =>
          item.category === "E" &&
          item.code === code &&
          Number(item.quantity) === 50
      ),
      true,
      `expected E${code}=50 from 522 repeated permutation`
    );
  }

  assert.ok(
    result.items.length > 3,
    "surrounding high-confidence items must remain preserved"
  );

  console.log(
    "PASS FRAGMENT-04 mixed valid block accepts repeated permutation"
  );
}
