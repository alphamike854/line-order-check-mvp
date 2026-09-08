import assert from "node:assert/strict";
import fs from "node:fs";

import {
  shouldReviewOcrParseResult,
} from "./src/lib/image-ocr.mjs";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";


function total(result) {
  return (result?.items ?? []).reduce(
    (sum, item) =>
      sum + Number(item?.quantity ?? 0),
    0,
  );
}


function itemMap(result) {
  return new Map(
    (result?.items ?? []).map(
      (item) => [
        `${item.category}${item.code}`,
        Number(item.quantity),
      ],
    ),
  );
}


const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push({
      name,
      message:
        error?.message
        ?? String(error),
    });

    console.error(`FAIL: ${name}`);
    console.error(
      error?.message
      ?? String(error),
    );
  }
}


console.log(
  `CURRENT_PARSER_VERSION=${PARSER_VERSION}`,
);


/*
 * GOLDEN 1
 *
 * Production:
 * 2026-09-08 19:51:50
 * business_date 2026-09-02
 * NORTH / องุ่น / Round 5
 *
 * บลก = ABC
 * A + B + reverse codes.
 */
check(
  "G1 บลก multiline blocks preserve reverse semantics",
  () => {
    const result =
      parseOrder(`
บลก.
69
92
09
=1500*1500

บลก.
90
80
37
36
=1250*1250
`);

    assert.equal(
      result.status,
      "PARSED",
    );

    assert.equal(
      total(result),
      38000,
      "expected company total 38,000",
    );

    assert.equal(
      result.items.length,
      24,
      "expected 12 distinct codes in A and B",
    );

    const map = itemMap(result);

    const expected = {
      A69: 1500,
      A96: 1500,
      A92: 1500,
      A29: 1500,
      A09: 2750,
      A90: 2750,

      A80: 1250,
      A08: 1250,
      A37: 1250,
      A73: 1250,
      A36: 1250,
      A63: 1250,

      B69: 1500,
      B96: 1500,
      B92: 1500,
      B29: 1500,
      B09: 2750,
      B90: 2750,

      B80: 1250,
      B08: 1250,
      B37: 1250,
      B73: 1250,
      B36: 1250,
      B63: 1250,
    };

    for (
      const [key, quantity]
      of Object.entries(expected)
    ) {
      assert.equal(
        map.get(key),
        quantity,
        `${key} mismatch`,
      );
    }
  },
);


/*
 * GOLDEN 2
 *
 * Production:
 * 2026-09-08 20:14:25
 *
 * A slash-separated code list followed by
 * an explicit trailing direction quantity.
 */
check(
  "G2 slash code list + trailing 1000บน",
  () => {
    const result =
      parseOrder(`
75/57
87/78
54/45
1000บน
`);

    assert.equal(
      result.status,
      "PARSED",
    );

    assert.equal(
      total(result),
      6000,
      "expected company total 6,000",
    );

    const map = itemMap(result);

    assert.deepEqual(
      [...map.entries()].sort(),
      [
        ["A45", 1000],
        ["A54", 1000],
        ["A57", 1000],
        ["A75", 1000],
        ["A78", 1000],
        ["A87", 1000],
      ],
    );
  },
);


/*
 * GOLDEN 3
 *
 * Production:
 * 2026-09-08 20:17:05.910
 *
 * รูดเบิ้ล means:
 * 00 11 22 ... 99
 * in both A/B for explicit บ-ล.
 */
check(
  "G3 รูดเบิ้ล 200x200 บ-ล",
  () => {
    const result =
      parseOrder(
        "รูดเบิ้ล 200x200 บ-ล",
      );

    assert.equal(
      result.status,
      "PARSED",
    );

    assert.equal(
      total(result),
      4000,
      "expected company total 4,000",
    );

    assert.equal(
      result.items.length,
      20,
    );

    const map = itemMap(result);

    for (
      const code
      of [
        "00",
        "11",
        "22",
        "33",
        "44",
        "55",
        "66",
        "77",
        "88",
        "99",
      ]
    ) {
      assert.equal(
        map.get(`A${code}`),
        200,
      );

      assert.equal(
        map.get(`B${code}`),
        200,
      );
    }
  },
);


/*
 * GOLDEN 4
 *
 * Production:
 * 2026-09-08 20:17:06.113
 *
 * Explicit "00-99 เลขเบิ้ล" means
 * all ten doubles, not just endpoints.
 */
check(
  "G4 00-99 เลขเบิ้ล 1200x1200 บล",
  () => {
    const result =
      parseOrder(`
รูดตั้งแต่00-99เลขเบิ้ล=1200*1200

บล
`);

    assert.equal(
      result.status,
      "PARSED",
    );

    assert.equal(
      total(result),
      24000,
      "expected company total 24,000",
    );

    assert.equal(
      result.items.length,
      20,
    );

    const map = itemMap(result);

    for (
      const code
      of [
        "00",
        "11",
        "22",
        "33",
        "44",
        "55",
        "66",
        "77",
        "88",
        "99",
      ]
    ) {
      assert.equal(
        map.get(`A${code}`),
        1200,
      );

      assert.equal(
        map.get(`B${code}`),
        1200,
      );
    }
  },
);


/*
 * GOLDEN 5
 *
 * Production image:
 * 2026-09-08 20:12:11
 *
 * OCR returned structurally suspicious text:
 *
 * 574 = 50x50 4092 50x50
 * 3812 50x50 6142 50x50
 * 8702 50x50 4892 50x50.
 * 7322 50x5
 *
 * Parser happened to emit A50=100/B50=55,
 * total 155, while company Human Truth is
 * 3,450.
 *
 * Image path must fail closed before treating
 * such a parse as canonical truth.
 */
check(
  "G5 image OCR structurally suspicious parse must have fail-closed gate",
  () => {
    const webhook =
      fs.readFileSync(
        "./netlify/functions/line-webhook.mjs",
        "utf8",
      );

    assert.match(
      webhook,
      /OCR_PARSE_LOW_CONFIDENCE/,
      "image pipeline needs an explicit OCR parse-confidence review reason",
    );

    assert.match(
      webhook,
      /shouldReviewOcrParseResult/,
      "image pipeline needs a structural OCR parse safety gate",
    );

    const parseIndex =
      webhook.indexOf(
        "const result = parseOrder(ocr.text, config);",
      );

    const persistIndex =
      webhook.indexOf(
        "return persistParsedResult(",
        parseIndex,
      );

    assert.ok(
      parseIndex >= 0
      && persistIndex > parseIndex,
      "OCR parse/persist anchors missing",
    );

    const boundary =
      webhook.slice(
        parseIndex,
        persistIndex,
      );

    assert.match(
      boundary,
      /shouldReviewOcrParseResult/,
      "OCR structural safety must execute after parse and before persistence",
    );

    assert.match(
      boundary,
      /OCR_PARSE_LOW_CONFIDENCE/,
      "fail-closed OCR path must carry an explicit Review reason",
    );

    assert.match(
      boundary,
      /status:\s*"REVIEW"[\s\S]*items:\s*\[\]/,
      "unsafe OCR parse must become REVIEW with zero canonical items",
    );

    const suspiciousOcr = `
574 = 50x50 4092 50x50
3812 50x50 6142 50x50
8702 50x50 4892 50x50.
7322 50x5
`;

    const suspiciousResult =
      parseOrder(
        suspiciousOcr,
      );

    assert.equal(
      suspiciousResult.status,
      "PARSED",
      "production OCR remains parser-plausible before image safety gating",
    );

    assert.equal(
      shouldReviewOcrParseResult(
        suspiciousOcr,
        suspiciousResult,
      ),
      true,
      "structurally suspicious OCR must fail closed",
    );

    for (
      const safeText
      of [
        "23=500",
        "01=20x20",
        "123=50x50",
      ]
    ) {
      assert.equal(
        shouldReviewOcrParseResult(
          safeText,
          parseOrder(safeText),
        ),
        false,
        `simple OCR must not false-positive: ${safeText}`,
      );
    }
  },
);


console.log();
console.log(
  `FAILURE_COUNT=${failures.length}`,
);

for (const failure of failures) {
  console.log();
  console.log(
    `--- ${failure.name} ---`,
  );
  console.log(
    failure.message,
  );
}


/*
 * All five contracts are expected to FAIL
 * before the R10B implementation.
 */
if (failures.length) {
  console.error();
  console.error(
    "EXPECTED RED: grape golden regressions are not fixed yet",
  );

  process.exit(1);
}

console.log();
console.log(
  "PASS: grape golden parser/OCR regressions",
);
