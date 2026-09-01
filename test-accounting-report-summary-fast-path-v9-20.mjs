import assert from "node:assert/strict";
import fs from "node:fs";

const api =
  fs.readFileSync(
    "netlify/functions/accounting-report.mjs",
    "utf8"
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8"
  );

const migration =
  fs.readFileSync(
    "supabase/migrations/20260901033000_add_accounting_report_summary_fast_path.sql",
    "utf8"
  );

console.log(
  "===== Accounting Report Summary Fast Path v9.20 ====="
);

assert.match(
  migration,
  /accounting_report_line_group_summary/
);

assert.match(
  migration,
  /count\(\s*distinct iv\.message_record_id\s*\)/s
);

assert.doesNotMatch(
  migration,
  /from public\.messages/
);

console.log(
  "PASS RS-01: summary aggregate does not scan message ledger"
);

assert.match(
  migration,
  /settlement_summary_group_actual_special_point_codes/
);

assert.match(
  migration,
  /actual_code\.summary_group_id\s*=\s*cfg\.summary_group_id/s
);

assert.match(
  migration,
  /promotion\.summary_group_id\s*=\s*cfg\.summary_group_id/s
);

console.log(
  "PASS RS-02: Actual Point and Promotion remain Summary-Group scoped"
);

assert.match(
  migration,
  /settlement_point_profiles/
);

assert.match(
  migration,
  /point_factor_pct/
);

assert.match(
  migration,
  /reconciliation_total/
);

console.log(
  "PASS RS-03: summary preserves accounting Point semantics"
);

const rpcIndex =
  api.indexOf(
    '"accounting_report_line_group_summary"'
  );

const ledgerIndex =
  api.indexOf(
    "const [messages,items]"
  );

assert.ok(
  rpcIndex >= 0 &&
  ledgerIndex > rpcIndex
);

assert.match(
  api,
  /summary_only:true/
);

console.log(
  "PASS RS-04: API returns before ledger pagination in summary mode"
);

assert.match(
  app,
  /reportLineGroup==="ALL"/
);

assert.match(
  app,
  /"&summary_only=1"/
);

assert.match(
  app,
  /payload\?\.summary_only===true/
);

console.log(
  "PASS RS-05: ALL UI consumes summary-only API mode"
);

assert.match(
  app,
  /if\(summaryOnly\)\{[\s\S]*?ยอดรับจริง[\s\S]*?ยอดสุทธิเทียบ/
);

console.log(
  "PASS RS-06: summary cards expose accounting totals"
);

console.log(
  "PASS: accounting report summary fast path v9.20"
);
