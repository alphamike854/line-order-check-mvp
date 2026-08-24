import assert from "node:assert/strict";
import { bangkokDayRange, normalizeBusinessDate, normalizeSummaryGroup } from "./src/lib/dashboard-utils.mjs";

assert.equal(normalizeBusinessDate("2026-08-24"), "2026-08-24");
assert.equal(normalizeSummaryGroup("ALL"), null);
assert.equal(normalizeSummaryGroup("NORTH"), "NORTH");
assert.throws(() => normalizeBusinessDate("24/08/2026"));

const range = bangkokDayRange("2026-08-24");
assert.equal(range.startIso, "2026-08-23T17:00:00.000Z");
assert.equal(range.endIso, "2026-08-24T17:00:00.000Z");

console.log("PASS: Dashboard helper smoke tests");
