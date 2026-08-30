import assert from "node:assert/strict";
import {
  parseOrder,
} from "./src/lib/order-parser.mjs";

function canonical(result) {
  return (result.items || [])
    .map(
      (x) =>
        `${x.category}${x.code}=${Number(x.quantity)}`
    )
    .sort();
}

function total(result) {
  return (result.items || []).reduce(
    (sum, x) =>
      sum + Number(x.quantity || 0),
    0
  );
}

// ------------------------------------------------------------
// P2F-01
// Exact production collective TOD block.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `โต้ดตัวละ60
364
246
672
249`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 4);
  assert.equal(total(result), 240);

  assert.deepEqual(
    canonical(result),
    [
      "F246=60",
      "F249=60",
      "F364=60",
      "F672=60",
    ].sort()
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);

  console.log(
    "PASS P2F-01 collective TOD 60"
  );
}

// ------------------------------------------------------------
// P2F-02
// Second confirmed production family.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `โต้ดตัวละ120
792
925
257
579`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 4);
  assert.equal(total(result), 480);

  assert.deepEqual(
    canonical(result),
    [
      "F257=120",
      "F579=120",
      "F792=120",
      "F925=120",
    ].sort()
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);

  console.log(
    "PASS P2F-02 collective TOD 120"
  );
}

// ------------------------------------------------------------
// P2F-SAFETY-01
// Single 3-digit code must no longer cross widths and become
// A60=364. Explicit TOD context makes it F364=60.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `โต้ดตัวละ60
364`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 1);
  assert.equal(total(result), 60);

  assert.deepEqual(
    canonical(result),
    ["F364=60"]
  );

  assert.equal(
    canonical(result).includes("A60=364"),
    false
  );

  console.log(
    "PASS P2F-SAFETY-01 single code stays 3-digit TOD"
  );
}

// ------------------------------------------------------------
// P2F-SAFETY-02
// Alternate spelling โต๊ด has identical semantics.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `โต๊ดตัวละ60
364
246
672
249`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 4);
  assert.equal(total(result), 240);

  assert.deepEqual(
    canonical(result),
    [
      "F246=60",
      "F249=60",
      "F364=60",
      "F672=60",
    ].sort()
  );

  console.log(
    "PASS P2F-SAFETY-02 alternate TOD spelling"
  );
}

// ------------------------------------------------------------
// P2F-SAFETY-03
// Existing compact semantic baseline remains unchanged.
// ------------------------------------------------------------
{
  const result = parseOrder(
    "364 246 672 249=60 โต้ด"
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 4);
  assert.equal(total(result), 240);

  assert.deepEqual(
    canonical(result),
    [
      "F246=60",
      "F249=60",
      "F364=60",
      "F672=60",
    ].sort()
  );

  console.log(
    "PASS P2F-SAFETY-03 compact baseline unchanged"
  );
}

// ------------------------------------------------------------
// P2F-SAFETY-04
// A different-width assignment terminates the TOD code block
// and must remain independently parseable.
// ------------------------------------------------------------
{
  const result = parseOrder(
    `โต้ดตัวละ60
364
36=20`
  );

  assert.equal(result.status, "PARSED");
  assert.equal(result.items.length, 2);
  assert.equal(total(result), 80);

  assert.deepEqual(
    canonical(result),
    [
      "A36=20",
      "F364=60",
    ].sort()
  );

  console.log(
    "PASS P2F-SAFETY-04 mixed-width boundary preserved"
  );
}

console.log(
  "PASS: production parser P2F collective TOD regression v9.9"
);
