import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";


function itemMap(result) {
  return Object.fromEntries(
    result.items.map(
      (item) => [
        `${item.category}${item.code}`,
        item.quantity,
      ]
    )
  );
}


function expectUnmarkedChainReview(text) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "REVIEW",
    text,
  );

  assert.equal(
    result.items.length,
    0,
    text,
  );

  assert.ok(
    result.errors.some(
      (error) =>
        error.code ===
        "UNSUPPORTED_QUANTITY_EXPRESSION"
    ),
    text,
  );

  assert.ok(
    result.rule_ids.includes(
      "R_3DIGIT_UNMARKED_QUANTITY_CHAIN"
    ),
    text,
  );
}


assert.ok(
  PARSER_VERSION.startsWith("1.")
);


// Unmarked 3+ quantity chains no longer imply permutation.
for (const text of [
  "998=100x100x100",
  "093=100x100x100x100x100x100",
  "998=100x100x100x100",
  "998=100x200x100",
]) {
  expectUnmarkedChainReview(text);
}


// Explicit vocabulary remains permutation.
for (const text of [
  "998=100 ทุกกลับ",
  "998=100 3ปต",
  "998=100 3ประตู",
]) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    text,
  );

  assert.deepEqual(
    itemMap(result),
    {
      E899: 100,
      E989: 100,
      E998: 100,
    },
    text,
  );
}


const sixDoor = parseOrder(
  "093=100 ทุกกลับ"
);

assert.equal(
  sixDoor.status,
  "PARSED",
);

assert.deepEqual(
  itemMap(sixDoor),
  {
    E039: 100,
    E093: 100,
    E309: 100,
    E390: 100,
    E903: 100,
    E930: 100,
  },
);


// Two-value expressions remain ordinary E/F pairs.
assert.deepEqual(
  itemMap(
    parseOrder(
      "998=100x3"
    )
  ),
  {
    E998: 100,
    F998: 3,
  },
);

assert.deepEqual(
  itemMap(
    parseOrder(
      "093=100x6"
    )
  ),
  {
    E093: 100,
    F093: 6,
  },
);

assert.deepEqual(
  itemMap(
    parseOrder(
      "998=100x100"
    )
  ),
  {
    E998: 100,
    F998: 100,
  },
);


// Multi-code E/F remains unchanged.
const multiEfPair =
  parseOrder(
    "920,202,707,101=500x500"
  );

assert.equal(
  multiEfPair.status,
  "PARSED",
);

assert.equal(
  multiEfPair.items.length,
  8,
);


// Retired malformed x* syntax remains fail-closed.
const oldWrongForm =
  parseOrder(
    "998=100x100x*100"
  );

assert.equal(
  oldWrongForm.status,
  "REVIEW",
);

assert.ok(
  oldWrongForm.errors.some(
    (error) =>
      error.code ===
      "INVALID_XSTAR_PERMUTATION"
  ),
);


console.log(
  "PASS: explicit-marker permutation + unmarked-chain safety v7.3"
);
