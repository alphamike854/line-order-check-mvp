import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

const source = `797
971
918
773
718
10*10

16/09/26
100
พี่ป๊อบ`;

const result =
  parseOrder(source);

/*
 * Critical safety:
 *
 * 16/09/26 is metadata/date context.
 *
 * It must NEVER create:
 *
 *   A16 / B16
 *   A09 / B09
 *   A26 / B26
 *
 * The unresolved 3-digit block may remain REVIEW
 * until its semantics are explicitly contracted.
 */

const forbidden =
  new Set([
    "A|16",
    "B|16",
    "A|09",
    "B|09",
    "A|26",
    "B|26",
  ]);

for (const item of result.items || []) {
  assert.equal(
    forbidden.has(
      `${item.category}|${item.code}`
    ),
    false,
    "date token leaked into 2-digit order items",
  );
}

assert.notEqual(
  result.status,
  "PARSED",
  "uncontracted 3-digit trailing-pair block must remain fail-closed",
);

console.log(
  `PARSER_VERSION=${PARSER_VERSION}`
);

console.log(
  `STATUS=${result.status}`
);

console.log(
  `ITEM_COUNT=${(result.items || []).length}`
);

console.log(
  "PASS: 13938 date cannot create false 2-digit orders"
);
