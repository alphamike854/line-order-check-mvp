import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

assert.equal(PARSER_VERSION, "1.7.24");

function canonical(result) {
  return [...result.items]
    .map(
      (item) =>
        `${item.category}${item.code}=${item.quantity}`,
    )
    .sort();
}

function reverse2(code) {
  return code.split("").reverse().join("");
}

{
  const result =
    parseOrder("รูด6=300*300");

  assert.equal(
    result.status,
    "PARSED",
    "supported รูด pair must not be downgraded to PARTIAL",
  );

  const codes = [
    ...new Set(
      Array.from(
        { length: 10 },
        (_, i) => `6${i}`,
      ).flatMap(
        (code) => [
          code,
          reverse2(code),
        ],
      ),
    ),
  ];

  const expected =
    codes.flatMap(
      (code) => [
        `A${code}=300`,
        `B${code}=300`,
      ],
    );

  assert.equal(result.items.length, 38);

  assert.deepEqual(
    canonical(result),
    expected.sort(),
  );

  assert.deepEqual(
    result.errors,
    [],
  );

  assert.equal(
    result.rule_ids.includes("R_REVERSE"),
    true,
  );

  console.log(
    "PASS SWEEP-01 รูด6=300*300 uses 19-code company rule",
  );
}

console.log(
  "PASS: sweep equals regression v9.1 / company rule v9.32",
);
