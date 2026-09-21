import assert from "node:assert/strict";
import fs from "node:fs";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

const fixture =
  JSON.parse(
    fs.readFileSync(
      new URL(
        "./test-parser-phase-a-front-end-gold.fixture.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

assert.equal(
  fixture.contract,
  "PHASE_A_FRONT_END_GOLD_V1",
);

assert.equal(
  fixture.case_count,
  46,
);

function canonicalItems(result) {
  const map = new Map();

  for (const item of result.items || []) {
    const key =
      `${String(item.category || "")}|${String(item.code || "")}`;

    map.set(
      key,
      (map.get(key) || 0)
      + Number(item.quantity || 0),
    );
  }

  return [...map.entries()]
    .sort(
      (a, b) =>
        a[0].localeCompare(b[0]),
    )
    .map(([key, quantity]) => {
      const [category, code] =
        key.split("|");

      return {
        category,
        code,
        quantity,
      };
    });
}

function errorCodes(result) {
  return (result.errors || [])
    .map(
      error =>
        error?.code
        || error?.reason
        || String(error),
    );
}

let pass = 0;
let fail = 0;

const failures = [];

for (const testCase of fixture.cases) {
  let result;

  try {
    result =
      parseOrder(
        testCase.source_text,
      );
  } catch (error) {
    fail += 1;

    failures.push({
      review_id:
        testCase.review_id,

      reason:
        "THREW",

      detail:
        String(
          error?.stack
          || error,
        ),
    });

    continue;
  }

  const actualItems =
    canonicalItems(result);

  const statusOk =
    result.status
    === testCase.expected_status;

  const errorsOk =
    (result.errors || []).length
    === 0;

  const itemsOk =
    JSON.stringify(actualItems)
    ===
    JSON.stringify(
      testCase.expected_items,
    );

  if (
    statusOk
    &&
    errorsOk
    &&
    itemsOk
  ) {
    pass += 1;

    console.log(
      `PASS PHASE-A-${testCase.review_id}`
    );

    continue;
  }

  fail += 1;

  failures.push({
    review_id:
      testCase.review_id,

    cluster:
      testCase.cluster,

    original_v2_class:
      testCase.original_v2_class,

    status:
      result.status,

    expected_status:
      testCase.expected_status,

    errors:
      errorCodes(result),

    items_match:
      itemsOk,

    actual_items:
      actualItems,

    expected_items:
      testCase.expected_items,
  });

  console.log(
    `RED PHASE-A-${testCase.review_id}`
    + ` status=${result.status}`
    + ` errors=${errorCodes(result).join(",") || "-"}`
    + ` items=${itemsOk ? "MATCH" : "DIFF"}`
  );
}

console.log();
console.log(
  `PHASE_A_PARSER_VERSION=${PARSER_VERSION}`
);

console.log(
  `PHASE_A_PASS=${pass}`
);

console.log(
  `PHASE_A_RED=${fail}`
);

console.log(
  `PHASE_A_TOTAL=${pass + fail}`
);

if (fail) {
  console.log();
  console.log(
    "===== RED DETAIL ====="
  );

  for (const failure of failures) {
    console.log(
      JSON.stringify(failure)
    );
  }
}

/*
 * This Gold file is intended to become GREEN after
 * the consolidated Phase A parser-front-end patch.
 */
assert.equal(
  fail,
  0,
  `${fail} Phase A Gold cases remain RED`,
);

console.log(
  "PASS: Phase A 46-case front-end Gold"
);
