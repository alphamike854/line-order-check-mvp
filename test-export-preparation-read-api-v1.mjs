import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildExportPreparationItems,
  summarizeExportPreparation,
} from "./src/lib/export-preparation-read-model.mjs";

const endpoint =
  fs.readFileSync(
    "netlify/functions/export-preparation.mjs",
    "utf8",
  );

const helper =
  fs.readFileSync(
    "src/lib/export-preparation-read-model.mjs",
    "utf8",
  );

const pkg =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

console.log(
  "===== Export Preparation Read API v1 =====",
);

assert.match(
  endpoint,
  /req\.method\s*!==\s*"GET"/,
);
console.log(
  "PASS EXP2A-01: endpoint is GET-only",
);

assert.match(
  endpoint,
  /requireDashboardAccess\s*\(\s*req\s*\)/,
);
console.log(
  "PASS EXP2A-02: Dashboard authentication is mandatory",
);

assert.match(
  endpoint,
  /SUMMARY_GROUP_REQUIRED/,
);

assert.match(
  endpoint,
  /normalizeSummaryGroup/,
);

console.log(
  "PASS EXP2A-03: ALL is rejected; exact Summary Group is required",
);

assert.match(
  endpoint,
  /\.from\(\s*"settlement_summary_group_rounds"\s*,?\s*\)/,
);

assert.match(
  endpoint,
  /\.eq\(\s*"status"\s*,\s*"OPEN"\s*,?\s*\)/,
);

assert.match(
  endpoint,
  /SUMMARY_GROUP_ROUND_NOT_OPEN/,
);

console.log(
  "PASS EXP2A-04: preparation is bound to current OPEN Summary Group Round",
);

assert.match(
  endpoint,
  /supabase\.rpc\(\s*"dashboard_risk_snapshot"/,
);

assert.match(
  endpoint,
  /p_settlement_session_id\s*:\s*session\.id/,
);

assert.match(
  endpoint,
  /p_summary_group_id\s*:\s*summaryGroupId/,
);

console.log(
  "PASS EXP2A-05: current code truth reuses canonical Dashboard Risk snapshot",
);

assert.match(
  endpoint,
  /\.from\(\s*"settlement_export_sent_totals"\s*,?\s*\)/,
);

assert.match(
  endpoint,
  /\.eq\(\s*"summary_group_round_id"\s*,\s*round\.id\s*,?\s*\)/,
);

console.log(
  "PASS EXP2A-06: cumulative SENT truth is current-Round scoped",
);

assert.match(
  endpoint,
  /\.from\(\s*"settlement_export_cycles"\s*,?\s*\)/,
);

console.log(
  "PASS EXP2A-07: current-Round cycle state is readable for future UI",
);

for (const forbidden of [
  /\.insert\s*\(/,
  /\.update\s*\(/,
  /\.upsert\s*\(/,
  /\.delete\s*\(/,
]) {
  assert.doesNotMatch(
    endpoint,
    forbidden,
  );
}

console.log(
  "PASS EXP2A-08: endpoint performs no application DB mutation",
);

assert.doesNotMatch(
  endpoint,
  /settlement_transfer_batches/,
);

assert.doesNotMatch(
  endpoint,
  /settlement_transfer_batch_items/,
);

assert.doesNotMatch(
  endpoint,
  /confirmed_cut_total/,
);

console.log(
  "PASS EXP2A-09: Allocation / confirmed cut remains isolated",
);

assert.doesNotMatch(
  endpoint,
  /LINE_MESSAGE_MIRROR_ENABLED/,
);

assert.doesNotMatch(
  endpoint,
  /api\.line\.me/,
);

assert.doesNotMatch(
  endpoint,
  /pushMessage/,
);

console.log(
  "PASS EXP2A-10: endpoint has no LINE transport",
);

assert.match(
  helper,
  /Math\.max\(\s*currentQuantity\s*-\s*sentQuantity\s*,\s*0\s*,?\s*\)/,
);

assert.match(
  helper,
  /Math\.max\(\s*sentQuantity\s*-\s*currentQuantity\s*,\s*0\s*,?\s*\)/,
);

console.log(
  "PASS EXP2A-11: negative remainder is converted to reconciliation state",
);

const normal =
  buildExportPreparationItems({
    summaryGroupId:
      "EAST",

    riskCodes: [
      {
        summary_group_id:
          "EAST",
        category:
          "A",
        code:
          "59",
        order_total:
          6200,
        adjusted_total:
          6200,
        effective_multiplier:
          1,
        point_exposure:
          6200,
        confirmed_cut:
          0,
        available_to_cut:
          6200,
        retained_quantity:
          6200,
      },
    ],

    sentTotals: [
      {
        category:
          "A",
        code:
          "59",
        sent_cumulative_quantity:
          4500,
        sent_cycle_count:
          1,
        last_sent_at:
          "2026-09-22T12:45:00Z",
      },
    ],
  });

assert.equal(
  normal.length,
  1,
);

assert.equal(
  normal[0]
    .current_effective_quantity,
  6200,
);

assert.equal(
  normal[0]
    .sent_cumulative_quantity,
  4500,
);

assert.equal(
  normal[0]
    .available_quantity,
  1700,
);

assert.equal(
  normal[0]
    .over_sent_quantity,
  0,
);

assert.equal(
  normal[0]
    .reconciliation_required,
  false,
);

assert.equal(
  normal[0]
    .selectable,
  true,
);

console.log(
  "PASS EXP2A-12: 6,200 - 4,500 = 1,700",
);

const decreased =
  buildExportPreparationItems({
    summaryGroupId:
      "EAST",

    riskCodes: [
      {
        summary_group_id:
          "EAST",
        category:
          "A",
        code:
          "59",
        order_total:
          4000,
      },
    ],

    sentTotals: [
      {
        category:
          "A",
        code:
          "59",
        sent_cumulative_quantity:
          4500,
        sent_cycle_count:
          1,
        last_sent_at:
          null,
      },
    ],
  });

assert.equal(
  decreased[0]
    .available_quantity,
  0,
);

assert.equal(
  decreased[0]
    .over_sent_quantity,
  500,
);

assert.equal(
  decreased[0]
    .reconciliation_required,
  true,
);

assert.equal(
  decreased[0]
    .selectable,
  false,
);

console.log(
  "PASS EXP2A-13: UNSEND/correction cannot create negative export availability",
);

/*
 * Important union test:
 * current snapshot can lose a code completely after correction/UNSEND,
 * while prior SENT remains in the Round ledger.
 */
const disappeared =
  buildExportPreparationItems({
    summaryGroupId:
      "EAST",

    riskCodes:
      [],

    sentTotals: [
      {
        category:
          "B",
        code:
          "11",
        sent_cumulative_quantity:
          1000,
        sent_cycle_count:
          1,
        last_sent_at:
          null,
      },
    ],
  });

assert.equal(
  disappeared.length,
  1,
);

assert.equal(
  disappeared[0]
    .current_effective_quantity,
  0,
);

assert.equal(
  disappeared[0]
    .sent_cumulative_quantity,
  1000,
);

assert.equal(
  disappeared[0]
    .over_sent_quantity,
  1000,
);

assert.equal(
  disappeared[0]
    .reconciliation_required,
  true,
);

console.log(
  "PASS EXP2A-14: previously SENT code remains visible after current code disappears",
);

const totals =
  summarizeExportPreparation([
    ...normal,
    ...decreased,
  ]);

assert.equal(
  totals.code_count,
  2,
);

assert.equal(
  totals.available_quantity,
  1700,
);

assert.equal(
  totals.over_sent_quantity,
  500,
);

assert.equal(
  totals.selectable_code_count,
  1,
);

assert.equal(
  totals.reconciliation_required_count,
  1,
);

console.log(
  "PASS EXP2A-15: aggregate preparation totals are deterministic",
);

assert.doesNotMatch(
  helper,
  /%\s*500/,
);

assert.doesNotMatch(
  helper,
  /500\s*\/\s*1000/,
);

console.log(
  "PASS EXP2A-16: read model does not lock operator cut units",
);

assert.match(
  pkg,
  /test-export-preparation-read-api-v1\.mjs/,
);

console.log(
  "PASS EXP2A-17: Phase 2A is registered in full regression",
);

console.log(
  "PASS: Export Preparation Read API v1",
);
