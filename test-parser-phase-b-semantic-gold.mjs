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
        "./test-parser-phase-b-semantic-gold.fixture.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

assert.equal(
  fixture.contract,
  "PHASE_B_SEMANTIC_BINDING_GOLD_V2",
);

assert.equal(
  fixture.case_count,
  42,
);

function canonical(result) {
  const map = new Map();

  for (const item of result.items || []) {
    const key =
      `${String(item.category || "")}`
      + `|${String(item.code || "")}`;

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

function expectedCanonical(testCase) {
  const map = new Map();

  for (
    const item
    of testCase.expected_items || []
  ) {
    const key =
      `${item.category}|${item.code}`;

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

let green = 0;
let red = 0;

const failures = [];

for (const testCase of fixture.cases) {
  const result =
    parseOrder(
      testCase.source_text,
    );

  const actual =
    canonical(result);

  const expected =
    expectedCanonical(
      testCase,
    );

  const statusOk =
    result.status === "PARSED";

  const errorOk =
    (result.errors || []).length
    === 0;

  const itemsOk =
    JSON.stringify(actual)
    === JSON.stringify(expected);

  if (
    statusOk
    &&
    errorOk
    &&
    itemsOk
  ) {
    green += 1;

    console.log(
      `GREEN PHASE-B-${testCase.review_id}`
    );

    continue;
  }

  red += 1;

  failures.push({
    review_id:
      testCase.review_id,

    status:
      result.status,

    errors:
      (result.errors || [])
        .map(
          x =>
            x?.code
            || x?.reason
            || String(x)
        ),

    items_match:
      itemsOk,

    actual,

    expected,
  });

  console.log(
    `RED PHASE-B-${testCase.review_id}`
    + ` status=${result.status}`
    + ` items=${itemsOk ? "MATCH" : "DIFF"}`
  );
}

console.log();
console.log(
  `PHASE_B_PARSER_VERSION=${PARSER_VERSION}`
);

console.log(
  `PHASE_B_GREEN=${green}`
);

console.log(
  `PHASE_B_RED=${red}`
);

console.log(
  `PHASE_B_TOTAL=${green + red}`
);

console.log();

for (const failure of failures) {
  console.log(
    JSON.stringify(failure)
  );
}

assert.equal(
  red,
  0,
  `${red} Phase B cases remain RED`,
);

console.log(
  "PASS: Phase B semantic/binding Gold"
);
