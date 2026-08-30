import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

let passed = 0;
let failed = 0;

function items(result) {
  return result.items
    .map((x) => `${x.category}${x.code}=${Number(x.quantity)}`)
    .sort();
}

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}`);
    console.error(`     ${error.message}`);
  }
}

function expectItems(text, expected, expectedStatus = "PARSED") {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    expectedStatus,
    `status for ${JSON.stringify(text)}`
  );

  assert.deepEqual(
    items(result),
    [...expected].sort(),
    `items for ${JSON.stringify(text)}`
  );

  return result;
}


// ============================================================
// A. CODE WIDTH DEFAULTS
// ============================================================

check("WIDTH-01 1 digit without direction must not IGNORE", () => {
  const r = parseOrder("4=20");

  assert.notEqual(r.status, "IGNORE");
  assert.equal(r.items.length, 0);
});

check("WIDTH-02 2 digit single defaults to A", () => {
  expectItems(
    "01=20",
    ["A01=20"]
  );
});

check("WIDTH-03 2 digit pair defaults to A/B", () => {
  expectItems(
    "01=20*30",
    ["A01=20", "B01=30"]
  );
});

check("WIDTH-04 3 digit single defaults to E", () => {
  expectItems(
    "123=20",
    ["E123=20"]
  );
});

check("WIDTH-05 3 digit pair defaults to E/F", () => {
  expectItems(
    "123=20*30",
    ["E123=20", "F123=30"]
  );
});


// ============================================================
// B. ONE-DIGIT VOCABULARY
// ============================================================

check("ONE-01 วิ่งบน -> H", () => {
  expectItems(
    "วิ่งบน 4=20",
    ["H4=20"]
  );
});

check("ONE-02 วิ่ง บ -> H", () => {
  expectItems(
    "วิ่ง บ 4=20",
    ["H4=20"]
  );
});

check("ONE-03 วิ่งล่าง -> L", () => {
  expectItems(
    "วิ่งล่าง 4=20",
    ["L4=20"]
  );
});

check("ONE-04 วิ่ง ล -> L", () => {
  expectItems(
    "วิ่ง ล 4=20",
    ["L4=20"]
  );
});


// ============================================================
// C. TWO-DIGIT CONTEXT VOCABULARY
// ============================================================

check("TWO-01 บน/บ -> A", () => {
  expectItems(
    `บน
01=20`,
    ["A01=20"]
  );

  expectItems(
    `บ
01=20`,
    ["A01=20"]
  );
});

check("TWO-02 ล่าง/ล -> B", () => {
  expectItems(
    `ล่าง
01=20`,
    ["B01=20"]
  );

  expectItems(
    `ล
01=20`,
    ["B01=20"]
  );
});

check("TWO-03 บล / บ-ล / บนล่าง -> A+B", () => {
  for (const context of ["บล", "บ-ล", "บนล่าง"]) {
    expectItems(
      `${context}
01=20`,
      ["A01=20", "B01=20"]
    );
  }
});

check("TWO-04 บลก -> A+B+reverse", () => {
  expectItems(
    `บลก
01=20`,
    [
      "A01=20",
      "A10=20",
      "B01=20",
      "B10=20",
    ]
  );
});


// ============================================================
// D. TWO-DIGIT OPERATORS
// ============================================================

check("TWO-05 รูด retains existing canonical grammar", () => {
  expectItems(
    "รูด 7-35 บล",
    [
      ...Array.from({ length: 10 }, (_, i) => `A7${i}=35`),
      ...Array.from({ length: 10 }, (_, i) => `B7${i}=35`),
    ]
  );
});

check("TWO-06 เบิ้ล single quantity means double-number set", () => {
  expectItems(
    "เบิ้ล 20",
    Array.from({ length: 10 }, (_, i) => `A${i}${i}=20`)
  );
});

check("TWO-07 เบิ้ล pair quantity means A/B double-number set", () => {
  expectItems(
    "เบิ้ล 20*30",
    [
      ...Array.from({ length: 10 }, (_, i) => `A${i}${i}=20`),
      ...Array.from({ length: 10 }, (_, i) => `B${i}${i}=30`),
    ]
  );
});


// ============================================================
// E. THREE-DIGIT DIRECT / STRAIGHT VOCABULARY
//
// เต็ง / ตรง => E
// ============================================================

for (const alias of ["เต็ง", "ตรง"]) {
  check(`THREE-DIRECT-01 ${alias} suffix`, () => {
    expectItems(
      `123 20 ${alias}`,
      ["E123=20"]
    );
  });

  check(`THREE-DIRECT-02 ${alias} middle`, () => {
    expectItems(
      `123 ${alias} 20`,
      ["E123=20"]
    );
  });

  check(`THREE-DIRECT-03 ${alias} after equals quantity`, () => {
    expectItems(
      `123=20 ${alias}`,
      ["E123=20"]
    );
  });

  check(`THREE-DIRECT-04 ${alias} header`, () => {
    expectItems(
      `${alias}
123=20`,
      ["E123=20"]
    );
  });
}


// ============================================================
// F. THREE-DIGIT TOD VOCABULARY
//
// โต๊ด / โต้ด => F
// ============================================================

for (const alias of ["โต๊ด", "โต้ด"]) {
  check(`THREE-TOD-01 ${alias} suffix`, () => {
    expectItems(
      `123 20 ${alias}`,
      ["F123=20"]
    );
  });

  check(`THREE-TOD-02 ${alias} middle`, () => {
    expectItems(
      `123 ${alias} 20`,
      ["F123=20"]
    );
  });

  check(`THREE-TOD-03 ${alias} after equals quantity`, () => {
    expectItems(
      `123=20 ${alias}`,
      ["F123=20"]
    );
  });

  check(`THREE-TOD-04 ${alias} header`, () => {
    expectItems(
      `${alias}
123=20`,
      ["F123=20"]
    );
  });
}


// ============================================================
// G. THREE-DIGIT PERMUTATION VOCABULARY
//
// กลับ / ประตู / ปะตู / ปต => all unique permutations
// ============================================================

const permutations123 = [
  "E123=20",
  "E132=20",
  "E213=20",
  "E231=20",
  "E312=20",
  "E321=20",
];

for (const alias of ["กลับ", "ประตู", "ปะตู", "ปต"]) {
  check(`THREE-PERM-01 ${alias} middle`, () => {
    expectItems(
      `123 ${alias} 20`,
      permutations123
    );
  });

  check(`THREE-PERM-02 ${alias} suffix`, () => {
    expectItems(
      `123 20 ${alias}`,
      permutations123
    );
  });

  check(`THREE-PERM-03 ${alias} after equals quantity`, () => {
    expectItems(
      `123=20 ${alias}`,
      permutations123
    );
  });

  check(`THREE-PERM-04 ${alias} header`, () => {
    expectItems(
      `${alias}
123=20`,
      permutations123
    );
  });
}


// ============================================================
// H. THREE-DIGIT CONTEXTUAL TOP/BOTTOM
// ============================================================

check("THREE-CONTEXT-01 3 digit บน -> E", () => {
  expectItems(
    "123=20 บน",
    ["E123=20"]
  );
});

check("THREE-CONTEXT-02 3 digit ล่าง -> G", () => {
  expectItems(
    "123=20 ล่าง",
    ["G123=20"]
  );
});

check("THREE-CONTEXT-03 3 digit pair บน -> E/F", () => {
  expectItems(
    "123=20*30 บน",
    ["E123=20", "F123=30"]
  );
});


// ============================================================
// I. UNKNOWN NATURAL LANGUAGE
//
// Unknown text is not an error merely because it contains a digit.
// ============================================================

check("NOISE-01 sender-like text with digit does not poison valid order", () => {
  expectItems(
    `ลาวยึด4
01=20`,
    ["A01=20"]
  );
});

check("NOISE-02 ordinary Thai name remains harmless", () => {
  expectItems(
    `สมชาย
01=20`,
    ["A01=20"]
  );
});

check("NOISE-03 arbitrary Thai text remains harmless", () => {
  expectItems(
    `ซื้อเลขลาวแนคับอ้าย
123=20`,
    ["E123=20"]
  );
});


// ============================================================
// J. ORDER-LIKE UNKNOWN MUST NEVER DISAPPEAR
// ============================================================

check("SAFETY-01 unsupported 3-digit dash pair remains Review-safe", () => {
  const r = parseOrder("593-50*50");

  assert.notEqual(r.status, "IGNORE");
  assert.equal(r.items.length, 0);
});

check("SAFETY-02 ambiguous natural 3-digit pair remains Review-safe", () => {
  const r = parseOrder("249 5*5");

  assert.equal(r.status, "REVIEW");
  assert.equal(r.items.length, 0);
});

check("THREE-PERM-05 repeated star quantities mean repeated permutations", () => {
  const r = parseOrder(
    "522=20*20*20"
  );

  assert.equal(r.status, "PARSED");
  assert.equal(r.items.length, 3);

  assert.deepEqual(
    r.items
      .map(
        item =>
          `${item.category}${item.code}=${item.quantity}`
      )
      .sort(),
    [
      "E225=20",
      "E252=20",
      "E522=20",
    ].sort()
  );

  assert.equal(
    r.rule_ids.includes(
      "R_3DIGIT_REPEATED_PERMUTATION"
    ),
    true
  );
});

check("SAFETY-04 bare 2-digit codes remain Review-safe", () => {
  const r = parseOrder("72 27");

  assert.equal(r.status, "REVIEW");
  assert.equal(r.items.length, 0);
});


console.log();
console.log("========================================");
console.log("Vocabulary Contract R1");
console.log("PASS:", passed);
console.log("FAIL:", failed);
console.log("========================================");

if (failed > 0) {
  process.exitCode = 1;
}
