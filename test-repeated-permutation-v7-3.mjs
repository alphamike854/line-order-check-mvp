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


assert.ok(
  PARSER_VERSION.startsWith("1.")
);


// Repeated equal quantities are permutation shorthand when the
// repeated-value count equals the code's unique permutations.
{
  const result =
    parseOrder(
      "998=100x100x100"
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    itemMap(result),
    {
      E899: 100,
      E989: 100,
      E998: 100,
    }
  );

  assert.ok(
    result.rule_ids.includes(
      "R_3DIGIT_REPEATED_PERMUTATION"
    )
  );
}


{
  const result =
    parseOrder(
      "093=100x100x100x100x100x100"
    );

  assert.equal(
    result.status,
    "PARSED"
  );

  assert.deepEqual(
    itemMap(result),
    {
      E039: 100,
      E093: 100,
      E309: 100,
      E390: 100,
      E903: 100,
      E930: 100,
    }
  );
}


// Count mismatch remains fail-closed.
for (const text of [
  "123=5x5x5",
  "998=100x100x100x100",
]) {
  const result =
    parseOrder(text);

  assert.equal(
    result.status,
    "REVIEW",
    text
  );

  assert.equal(
    result.items.length,
    0,
    text
  );

  assert.ok(
    result.errors.some(
      error =>
        error.code ===
          "PERMUTATION_COUNT_MISMATCH"
    ),
    text
  );
}


// Unequal repeated quantities remain fail-closed.
{
  const result =
    parseOrder(
      "998=100x200x100"
    );

  assert.equal(
    result.status,
    "REVIEW"
  );

  assert.equal(
    result.items.length,
    0
  );

  assert.ok(
    result.errors.some(
      error =>
        error.code ===
          "REPEATED_PERMUTATION_QUANTITY_MISMATCH"
    )
  );
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
