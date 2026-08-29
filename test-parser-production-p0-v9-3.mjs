import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

function canonical(result) {
  return [...(result.items || [])]
    .map(
      (item) =>
        `${item.category}${item.code}=${Number(item.quantity)}`
    )
    .sort();
}

function pairAB(codes, qty) {
  return codes.flatMap((code) => [
    `A${code}=${qty}`,
    `B${code}=${qty}`,
  ]);
}

function pairEF(codes, qty) {
  return codes.flatMap((code) => [
    `E${code}=${qty}`,
    `F${code}=${qty}`,
  ]);
}

function reverse2(code) {
  return code.split("").reverse().join("");
}

function blg(codes, qty) {
  const expanded = [
    ...new Set(
      codes.flatMap((code) => [
        code,
        reverse2(code),
      ])
    ),
  ];

  return pairAB(expanded, qty);
}

function check(name, text, expected) {
  const result = parseOrder(text);

  assert.equal(
    result.status,
    "PARSED",
    `${name}: expected PARSED, got ${result.status}`
  );

  assert.deepEqual(
    canonical(result),
    [...expected].sort(),
    `${name}: canonical items mismatch`
  );

  console.log(`PASS ${name}`);
}

// Mixed 2/3-digit codes sharing the same pair quantity.
check(
  "P0-01 mixed width 1000x1000",
  `204,20,02,40,04=1000x1000
60,06,24,42,242,124=1000x1000`,
  [
    ...pairAB(
      ["20", "02", "40", "04", "60", "06", "24", "42"],
      1000
    ),
    ...pairEF(
      ["204", "242", "124"],
      1000
    ),
  ]
);

check(
  "P0-02 mixed width 500x500",
  `30,03,50,05,002,003=500x500
909,606,60,06=500x500`,
  [
    ...pairAB(
      ["30", "03", "50", "05", "60", "06"],
      500
    ),
    ...pairEF(
      ["002", "003", "909", "606"],
      500
    ),
  ]
);

// Contextual short date must not become an order code.
check(
  "P0-03 inline short date metadata",
  `ลาว 28/8
66=100x100`,
  pairAB(["66"], 100)
);

check(
  "P0-04 short date plus slash orders",
  `ลาว 28/8
36/63=50x50
60/06=50x50`,
  pairAB(
    ["36", "63", "60", "06"],
    50
  )
);

// Valid บลก order must stay canonical when a trailing
// contextual short date is present.
check(
  "P0-05 trailing short date metadata",
  `10 62 40 = 500 บลก

ลาวๆ
28/8`,
  blg(
    ["10", "62", "40"],
    500
  )
);

// ------------------------------------------------------------
// Safety contracts
// ------------------------------------------------------------

{
  const result = parseOrder("28/8");

  assert.notEqual(
    result.status,
    "IGNORE",
    "bare 28/8 must not silently become metadata"
  );

  console.log(
    "PASS P0-SAFETY-01 bare short slash preserved"
  );
}

check(
  "P0-SAFETY-02 slash order preserved",
  "27/72=20x20",
  pairAB(["27", "72"], 20)
);

check(
  "P0-SAFETY-03 pure 2-digit unchanged",
  "01,02=20x20",
  pairAB(["01", "02"], 20)
);

check(
  "P0-SAFETY-04 pure 3-digit unchanged",
  "001,002=20x20",
  pairEF(["001", "002"], 20)
);

console.log(
  "PASS: production parser P0 regression v9.3"
);
