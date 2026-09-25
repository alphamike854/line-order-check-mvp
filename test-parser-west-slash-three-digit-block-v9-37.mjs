import assert from "node:assert/strict";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

assert.equal(
  PARSER_VERSION,
  "1.7.30",
  "v9.37 regression must run against parser 1.7.30",
);

let failures = 0;

function canonical(rows) {
  const totals = new Map();

  for (const row of rows ?? []) {
    const key =
      `${row.category}${row.code}`;

    totals.set(
      key,
      (totals.get(key) ?? 0)
        + Number(row.quantity ?? 0),
    );
  }

  return [...totals.entries()]
    .map(
      ([key, qty]) =>
        `${key}=${qty}`,
    )
    .sort();
}

function expectedSingle(
  category,
  codes,
  qty,
) {
  return codes
    .map(
      (code) =>
        `${category}${code}=${qty}`,
    )
    .sort();
}

function expectedPair(
  categories,
  codes,
  qty,
) {
  return categories
    .flatMap(
      (category) =>
        codes.map(
          (code) =>
            `${category}${code}=${qty}`,
        ),
    )
    .sort();
}

function permutations(code) {
  const chars = [...code];
  const result = new Set();

  function walk(prefix, rest) {
    if (!rest.length) {
      result.add(prefix);
      return;
    }

    for (
      let i = 0;
      i < rest.length;
      i += 1
    ) {
      walk(
        prefix + rest[i],
        [
          ...rest.slice(0, i),
          ...rest.slice(i + 1),
        ],
      );
    }
  }

  walk("", chars);

  return [...result].sort();
}

function expectedPermutationBlock(
  sourceCodes,
  qty,
) {
  return sourceCodes
    .flatMap(
      (source) =>
        permutations(source)
          .map(
            (code) =>
              `E${code}=${qty}`,
          ),
    )
    .sort();
}

function runCase(
  name,
  text,
  expected,
) {
  const result =
    parseOrder(text);

  const actual =
    canonical(
      result.items,
    );

  const errors =
    (result.errors ?? [])
      .map(
        (row) =>
          row?.code
          ?? String(row),
      );

  const warnings =
    (result.warnings ?? [])
      .map(
        (row) =>
          row?.code
          ?? String(row),
      );

  let passed = true;
  let reason = "";

  try {
    assert.equal(
      result.status,
      "PARSED",
    );

    assert.deepEqual(
      actual,
      [...expected].sort(),
    );
  } catch (error) {
    passed = false;
    reason =
      error?.message
      ?? String(error);
  }

  console.log();
  console.log(
    `===== ${name} =====`,
  );

  console.log(
    "STATUS="
    + result.status,
  );

  console.log(
    "ACTUAL="
    + JSON.stringify(actual),
  );

  console.log(
    "EXPECTED="
    + JSON.stringify(
      [...expected].sort(),
    ),
  );

  console.log(
    "ERRORS="
    + JSON.stringify(errors),
  );

  console.log(
    "WARNINGS="
    + JSON.stringify(warnings),
  );

  if (passed) {
    console.log(
      `PASS ${name}`,
    );
  } else {
    failures += 1;

    console.log(
      `FAIL ${name}`,
    );

    console.log(
      "FAIL_REASON="
      + reason.replace(
        /\s+/g,
        " ",
      ),
    );
  }
}

// ============================================================
// WEST production messages 008–013
//
// Regression contract for the former parser defect:
// first NN/NN pair is consumed as quantity instead of code pair
// even though a stronger trailing quantity directive exists.
// ============================================================

runCase(
  "WEST-008 slash codes + trailing top quantity",
  `บน
69/96
39/93
95/59
1000`,
  expectedSingle(
    "A",
    [
      "69",
      "96",
      "39",
      "93",
      "95",
      "59",
    ],
    1000,
  ),
);

runCase(
  "WEST-009 slash codes + trailing AB quantity pair",
  `97/79
98/89
78/87
1000/1000`,
  expectedPair(
    ["A", "B"],
    [
      "97",
      "79",
      "98",
      "89",
      "78",
      "87",
    ],
    1000,
  ),
);

runCase(
  "WEST-010 slash codes + trailing top1000",
  `27/72
05/50
07/70
บน1000`,
  expectedSingle(
    "A",
    [
      "27",
      "72",
      "05",
      "50",
      "07",
      "70",
    ],
    1000,
  ),
);

runCase(
  "WEST-011 slash codes + trailing bottom1000",
  `25/52
27/72
28/82
05/50
07/70
ล่าง1000`,
  expectedSingle(
    "B",
    [
      "25",
      "52",
      "27",
      "72",
      "28",
      "82",
      "05",
      "50",
      "07",
      "70",
    ],
    1000,
  ),
);

const west012Text =
`ล่าง
60/06
70/07
80/08
32/23
1000`;

const west012Expected =
  expectedSingle(
    "B",
    [
      "60",
      "06",
      "70",
      "07",
      "80",
      "08",
      "32",
      "23",
    ],
    1000,
  );

runCase(
  "WEST-012 lower slash codes + trailing quantity",
  west012Text,
  west012Expected,
);

// WEST-013 is a distinct LINE message with the same source text.
// Parser semantics must therefore be identical.
runCase(
  "WEST-013 repeated source message parses identically",
  west012Text,
  west012Expected,
);

// ============================================================
// 3-digit multiline block
// ============================================================

const threeDigitSources = [
  "123",
  "456",
  "789",
  "012",
];

runCase(
  "THREE-01 multiline 3D shared single quantity",
  `123
456
789
012=50`,
  expectedSingle(
    "E",
    threeDigitSources,
    50,
  ),
);

runCase(
  "THREE-02 multiline 3D shared E/F pair",
  `123
456
789
012=100x100`,
  expectedPair(
    ["E", "F"],
    threeDigitSources,
    100,
  ),
);

runCase(
  "THREE-03 multiline 3D shared permutation suffix",
  `123
456
789
012=50x6ปต`,
  expectedPermutationBlock(
    threeDigitSources,
    50,
  ),
);

// ============================================================
// Mixed 2-digit + 3-digit blocks.
//
// Each explicit terminal assignment closes only its own width
// block. Neither grammar may consume the neighboring block.
// ============================================================

runCase(
  "MIXED-01 independent 2D + 3D single quantities",
  `12
34=20
123
456
789
012=50`,
  [
    ...expectedSingle(
      "A",
      ["12", "34"],
      20,
    ),

    ...expectedSingle(
      "E",
      threeDigitSources,
      50,
    ),
  ],
);

runCase(
  "MIXED-02 independent 2D AB + 3D EF pairs",
  `12
34=20x20
123
456
789
012=100x100`,
  [
    ...expectedPair(
      ["A", "B"],
      ["12", "34"],
      20,
    ),

    ...expectedPair(
      ["E", "F"],
      threeDigitSources,
      100,
    ),
  ],
);

runCase(
  "MIXED-03 2D block + 3D permutation block",
  `12
34=20
123
456
789
012=50x6ปต`,
  [
    ...expectedSingle(
      "A",
      ["12", "34"],
      20,
    ),

    ...expectedPermutationBlock(
      threeDigitSources,
      50,
    ),
  ],
);

console.log();
console.log(
  "========================================",
);

console.log(
  "PARSER_VERSION="
  + PARSER_VERSION,
);

console.log(
  "CASE_COUNT=12",
);

console.log(
  "FAILURE_COUNT="
  + failures,
);

console.log(
  "TEST_COMPLETED=true",
);

if (failures > 0) {
  console.log(
    "CLASSIFICATION=FAIL",
  );

  process.exitCode = 1;
} else {
  console.log(
    "CLASSIFICATION=GREEN",
  );
}
