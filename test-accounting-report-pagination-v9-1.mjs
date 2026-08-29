import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync(
  "netlify/functions/accounting-report.mjs",
  "utf8",
);

assert.match(
  source,
  /const REPORT_PAGE_SIZE = 500;/,
  "accounting report must use bounded pagination",
);

assert.match(
  source,
  /\.range\(\s*from,\s*from \+ REPORT_PAGE_SIZE - 1,/s,
  "accounting report must page Supabase results with range()",
);

assert.ok(
  source.includes('from("messages")') &&
  source.includes('from("order_items")'),
  "both messages and order_items must be fetched through paginated report queries",
);

assert.ok(
  source.includes("fetchAllPages(() =>"),
  "accounting report must use fetchAllPages",
);

console.log(
  "PASS: accounting report paginates Supabase rows v9.1",
);
