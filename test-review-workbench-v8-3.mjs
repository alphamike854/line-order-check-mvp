import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(
  new URL("./public/app.js", import.meta.url),
  "utf8"
);

const settlement = fs.readFileSync(
  new URL("./netlify/functions/settlement.mjs", import.meta.url),
  "utf8"
);

const migration = fs.readFileSync(
  new URL(
    "./supabase/migrations/20260826233000_allow_close_with_open_reviews.sql",
    import.meta.url
  ),
  "utf8"
);

// Poll less aggressively.
assert.match(
  app,
  /const FRESHNESS_POLL_MS = 60_000;/
);

// Review must remain stable while LINE messages continue arriving.
assert.match(
  app,
  /else if \(activeTab === "review"\)/
);

assert.match(
  app,
  /Keep the Review workbench stable/
);

// Allocation and other transactional screens still retain stale protection.
assert.match(
  app,
  /setDashboardStale\(true\)/
);

// API must no longer expose open Review as a settlement-close blocker.
assert.doesNotMatch(
  settlement,
  /SETTLEMENT_HAS_OPEN_REVIEW/
);

// Database close function must still exist, but without the Review blocker.
assert.match(
  migration,
  /create or replace function public\.close_settlement_session/
);

assert.doesNotMatch(
  migration,
  /SETTLEMENT_HAS_OPEN_REVIEW/
);

assert.match(
  migration,
  /grant execute[\s\S]*close_settlement_session\(uuid,text\)[\s\S]*service_role/
);

// Review count is informational; it must never block settlement close.
assert.doesNotMatch(
  app,
  /if\(Number\(state\.dashboard\?\.metrics\?\.review_open\|\|0\)>0\)/,
  "Review count must not block settlement close",
);

assert.match(
  app,
  /reviewCount[\s\S]*DEFERRED[\s\S]*ไม่รวมในยอดที่ปิด/,
  "Close confirmation should explain deferred Review items",
);

console.log(
  "PASS: stable Review workbench + non-blocking settlement close v8.3 smoke tests"
);
