import assert from "node:assert/strict";
import fs from "node:fs";

const oldPath =
  "supabase/migrations/"
  + "20260907085000_add_high_total_verification_sort.sql";

const newPath =
  "supabase/migrations/"
  + "20260911143000_high_total_per_code_threshold.sql";

const oldSql =
  fs.readFileSync(
    oldPath,
    "utf8",
  );

const sql =
  fs.readFileSync(
    newPath,
    "utf8",
  );

const app =
  fs.readFileSync(
    "./public/app.js",
    "utf8",
  );


// HT1 — accepted historical migration stays immutable.
assert.match(
  oldSql,
  /=\s*'HIGH_TOTAL'[\s\S]*then\s+message_order_total[\s\S]*end\s+desc/i,
);

console.log(
  "PASS HT1-01: accepted historical High Total migration remains unchanged",
);


// HT2 — same RPC and sort modes remain.
assert.match(
  sql,
  /create\s+or\s+replace\s+function[\s\S]*public\.staff_workbench_pending_verifications/i,
);

assert.match(
  sql,
  /'RECENT'[\s\S]*'PRIORITY'[\s\S]*'HIGH_TOTAL'/i,
);

console.log(
  "PASS HT1-02: existing Human Verification RPC contract retained",
);


// HT3 — HIGH_TOTAL remains parseable-only.
assert.match(
  sql,
  /HIGH_TOTAL[\s\S]*needs_interpretation\s*=\s*false/i,
);

console.log(
  "PASS HT1-03: unsafe interpretation work stays out of HIGH_TOTAL",
);


// HT4 — per-code grouping, not whole-message sum.
assert.match(
  sql,
  /jsonb_array_elements\(/i,
);

assert.match(
  sql,
  /group\s+by[\s\S]*item\.value\s*->>\s*'category'[\s\S]*item\.value\s*->>\s*'code'/i,
);

assert.match(
  sql,
  /needs_interpretation\s*=\s*false[\s\S]*>=\s*500/i,
);

console.log(
  "PASS HT1-04: HIGH_TOTAL groups category+code and requires >= 500",
);


// HT5 — HIGH_TOTAL ordering uses grouped max.
const highStart =
  sql.indexOf(
    "-- HIGH_TOTAL:",
  );

const priorityStart =
  sql.indexOf(
    "-- PRIORITY:",
    highStart,
  );

assert.ok(
  highStart >= 0
  && priorityStart > highStart,
);

const highOrder =
  sql.slice(
    highStart,
    priorityStart,
  );

assert.match(
  highOrder,
  /jsonb_array_elements\(/i,
);

assert.match(
  highOrder,
  /max\(code_totals\.code_total\)/i,
);

assert.doesNotMatch(
  highOrder,
  /then\s+message_order_total/i,
);

console.log(
  "PASS HT1-05: HIGH_TOTAL sorts by largest category+code total",
);


// HT6 — PRIORITY keeps existing whole-message semantics.
const priorityOrder =
  sql.slice(
    priorityStart,
  );

assert.match(
  priorityOrder,
  /PRIORITY[\s\S]*then\s+message_order_total/i,
);

console.log(
  "PASS HT1-06: PRIORITY message_order_total behavior remains unchanged",
);


// HT7 — deterministic tie ordering preserved.
assert.match(
  sql,
  /event_timestamp\s+desc[\s\S]*message_record_id\s+desc/i,
);

console.log(
  "PASS HT1-07: deterministic time/id tie-break remains",
);


// HT8 — security and read-only boundaries preserved.
assert.match(
  sql,
  /security definer/i,
);

assert.match(
  sql,
  /revoke all[\s\S]*public[\s\S]*anon[\s\S]*authenticated/i,
);

assert.match(
  sql,
  /grant execute[\s\S]*service_role/i,
);

assert.doesNotMatch(
  sql,
  /update\s+public\.messages/i,
);

assert.doesNotMatch(
  sql,
  /insert\s+into\s+public\.message_verifications/i,
);

assert.doesNotMatch(
  sql,
  /insert\s+into\s+public\.order_items/i,
);

assert.doesNotMatch(
  sql,
  /archive_post_close_review_message/i,
);

console.log(
  "PASS HT1-08: High Total migration remains read-model only",
);


// HT9 — execute the browser grouping helper itself.
const helperStart =
  app.indexOf(
    "function staffVerificationPerCodeHighTotal(",
  );

const helperEnd =
  app.indexOf(
    "function staffVerificationTimelineBadgesHtml(",
    helperStart,
  );

assert.ok(
  helperStart >= 0
  && helperEnd > helperStart,
);

const helperSource =
  app.slice(
    helperStart,
    helperEnd,
  ).trim();

const perCode =
  Function(
    `"use strict"; return (${helperSource});`,
  )();

assert.deepEqual(
  perCode({
    items: [
      {
        category: "A",
        code: "01",
        quantity: 300,
      },
      {
        category: "A",
        code: "02",
        quantity: 300,
      },
    ],
  }),
  {
    category: "A",
    code: "01",
    total: 300,
  },
);

assert.deepEqual(
  perCode({
    items: [
      {
        category: "A",
        code: "01",
        quantity: 300,
      },
      {
        category: "A",
        code: "01",
        quantity: 250,
      },
    ],
  }),
  {
    category: "A",
    code: "01",
    total: 550,
  },
);

assert.equal(
  perCode({
    items: [
      {
        category: "A",
        code: "01",
        quantity: 500,
      },
    ],
  }).total,
  500,
);

assert.equal(
  perCode({
    items: [
      {
        category: "A",
        code: "01",
        quantity: 499,
      },
    ],
  }).total,
  499,
);

assert.equal(
  perCode({
    items: [
      {
        category: "A",
        code: "01",
        quantity: 300,
      },
      {
        category: "B",
        code: "01",
        quantity: 300,
      },
    ],
  }).total,
  300,
);

console.log(
  "PASS HT1-09: browser grouping semantics distinguish same-code and different-code totals",
);


// HT10 — Timeline uses per-code value and shows responsible code.
assert.match(
  app,
  /sortMode\s*===\s*"HIGHEST"[\s\S]*staffVerificationPerCodeHighTotal\([\s\S]*right[\s\S]*staffVerificationPerCodeHighTotal\([\s\S]*left/,
);

assert.match(
  app,
  /🟠 ยอดสูง[\s\S]*highTotalLabel/,
);

console.log(
  "PASS HT1-10: Timeline sort and badge use per-code High Total",
);

console.log(
  "PASS: HIGH_TOTAL per category+code >= 500",
);
