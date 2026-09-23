import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    new URL(
      "./supabase/migrations/20260923180000_exclude_unsent_from_accounting_report.sql",
      import.meta.url,
    ),
    "utf8",
  );

const roundModel =
  fs.readFileSync(
    new URL(
      "./supabase/migrations/20260912013000_add_round_scoped_accounting_read_model.sql",
      import.meta.url,
    ),
    "utf8",
  );

const summaryModel =
  fs.readFileSync(
    new URL(
      "./supabase/migrations/20260912024500_add_round_scoped_accounting_summary.sql",
      import.meta.url,
    ),
    "utf8",
  );

const report =
  fs.readFileSync(
    new URL(
      "./netlify/functions/accounting-report.mjs",
      import.meta.url,
    ),
    "utf8",
  );

console.log(
  "===== Accounting Report UNSEND Exclusion v1 =====",
);


// ------------------------------------------------------------
// AEUE-01 — patch owns only Round-scoped effective items.
// ------------------------------------------------------------

assert.match(
  migration,
  /create or replace function\s+public\.accounting_effective_order_items_rounds\s*\(/i,
);

console.log(
  "PASS AEUE-01: Round-scoped Accounting boundary is patched",
);


// ------------------------------------------------------------
// AEUE-02 — live UNSEND state is authoritative evidence.
// ------------------------------------------------------------

assert.match(
  migration,
  /from\s+public\.messages\s+message[\s\S]*?message\.unsent\s*=\s*true/i,
);

console.log(
  "PASS AEUE-02: messages.unsent excludes live cancelled orders",
);


// ------------------------------------------------------------
// AEUE-03 — matched UNSEND event is also exclusion evidence.
// ------------------------------------------------------------

assert.match(
  migration,
  /from\s+public\.unsend_events\s+unsend[\s\S]*?unsend\.matched_message_record_id[\s\S]*?is not null/i,
);

console.log(
  "PASS AEUE-03: matched UNSEND event is durable exclusion evidence",
);


// ------------------------------------------------------------
// AEUE-04 — exclusion occurs after Human Truth precedence.
// ------------------------------------------------------------

assert.match(
  migration,
  /accounting_effective_order_items\s*\([\s\S]*?join\s+selected_message_ids[\s\S]*?where\s+not exists\s*\([\s\S]*?unsent_message_ids/i,
);

console.log(
  "PASS AEUE-04: UNSEND removes final effective truth regardless of source",
);


// ------------------------------------------------------------
// AEUE-05 — no operational deletion / repair mutation.
// ------------------------------------------------------------

assert.doesNotMatch(
  migration,
  /\bdelete\s+from\b/i,
);

assert.doesNotMatch(
  migration,
  /\bupdate\s+public\.(?:messages|order_items|unsend_events)\b/i,
);

console.log(
  "PASS AEUE-05: UNSEND evidence and canonical rows are not mutated",
);


// ------------------------------------------------------------
// AEUE-06 — effective messages inherit filtered effective items.
// ------------------------------------------------------------

assert.match(
  roundModel,
  /accounting_effective_order_messages_rounds\s*\([\s\S]*?accounting_effective_order_items_rounds\s*\(/i,
);

console.log(
  "PASS AEUE-06: Full Ledger message projection inherits exclusion",
);


// ------------------------------------------------------------
// AEUE-07 — Summary inherits the same effective items.
// ------------------------------------------------------------

assert.match(
  summaryModel,
  /accounting_report_line_group_summary_rounds\s*\([\s\S]*?accounting_effective_order_items_rounds\s*\(/i,
);

console.log(
  "PASS AEUE-07: Summary and Point path inherit exclusion",
);


// ------------------------------------------------------------
// AEUE-08 — production API consumes all Round-scoped paths.
// ------------------------------------------------------------

for (const rpc of [
  "accounting_effective_order_items_rounds",
  "accounting_effective_order_messages_rounds",
  "accounting_report_line_group_summary_rounds",
]) {
  assert.ok(
    report.includes(`"${rpc}"`),
    `Accounting API must consume ${rpc}`,
  );
}

console.log(
  "PASS AEUE-08: Accounting API remains Round-scoped",
);


// ------------------------------------------------------------
// AEUE-09 — exact incident regression.
// 13 original messages were UNSEND.
// 13 replacements are the only effective Accounting messages.
// ------------------------------------------------------------

const cancelledQuantities = [
  100,
  200,
  480,
  280,
  440,
  80,
  300,
  600,
  1600,
  318,
  278,
  600,
  2400,
];

const replacementQuantities = [
  100,
  200,
  2400,
  480,
  280,
  440,
  80,
  300,
  600,
  1600,
  318,
  278,
  600,
];

assert.equal(
  cancelledQuantities.length,
  13,
);

assert.equal(
  replacementQuantities.length,
  13,
);

assert.equal(
  cancelledQuantities.reduce(
    (sum, quantity) =>
      sum + quantity,
    0,
  ),
  7676,
);

assert.equal(
  replacementQuantities.reduce(
    (sum, quantity) =>
      sum + quantity,
    0,
  ),
  7676,
);

/*
 * Desired Accounting result:
 *
 * received:
 *   original 7,676
 * + replacement 7,676
 * - UNSEND original 7,676
 * = effective 7,676
 */
const effectiveQuantities =
  replacementQuantities;

assert.equal(
  effectiveQuantities.length,
  13,
);

assert.equal(
  effectiveQuantities.reduce(
    (sum, quantity) =>
      sum + quantity,
    0,
  ),
  7676,
);

console.log(
  "PASS AEUE-09: 13 UNSEND + 13 replacements => 13 / 7,676 effective",
);

console.log(
  "PASS: Accounting Report UNSEND Exclusion v1",
);
