import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");

console.log("===== Export Preparation Read-only UI v1 =====");

assert.ok(
  html.includes('id="exportPreparationReadOnlyPanel"'),
);
console.log("PASS EXP2F2A-01: panel exists");

assert.equal(
  html.count?.("x"),
  undefined,
);

assert.ok(
  html.includes("<h3>เตรียมส่งออก</h3>"),
);
console.log("PASS EXP2F2A-02: legacy A/B advisory retained");

assert.ok(
  app.includes('"/api/export-preparation"'),
);
assert.ok(
  app.includes('"?group="'),
);
console.log("PASS EXP2F2A-03: read API bound");

const start = app.indexOf(
  "async function loadExportPreparationReadOnly()",
);
const end = app.indexOf(
  "async function loadDashboard({",
  start,
);

assert.ok(start >= 0);
assert.ok(end > start);

const source = app.slice(start, end);

for (const forbidden of [
  "/api/export-preparation-draft",
  "/api/export-preparation-ready",
  "/api/export-preparation-send",
  "/api/export-preparation-sent",
]) {
  assert.equal(source.includes(forbidden), false);
}

assert.equal(
  /\bmethod\s*:\s*["']POST["']/.test(source),
  false,
);

console.log("PASS EXP2F2A-04: GET-only UI");

assert.ok(
  source.includes('groupId === "ALL"'),
);
console.log("PASS EXP2F2A-05: ALL fails closed");

for (const field of [
  "current_effective_quantity",
  "sent_cumulative_quantity",
  "available_quantity",
  "over_sent_quantity",
  "reconciliation_required",
]) {
  assert.ok(app.includes(field), field);
}
console.log("PASS EXP2F2A-06: cumulative fields rendered");

for (const status of ["DRAFT", "READY", "SENT"]) {
  assert.ok(
    app.includes(`case "${status}"`),
  );
}
console.log("PASS EXP2F2A-07: lifecycle labels readable");

assert.ok(
  app.includes("exportPreparationReadGeneration"),
);
assert.ok(
  app.includes("EXPORT_PREPARATION_GROUP_MISMATCH"),
);
console.log("PASS EXP2F2A-08: stale/group guards present");

assert.ok(
  css.includes("EXPORT PREPARATION READ-ONLY UI V1"),
);
console.log("PASS EXP2F2A-09: styles present");

for (const id of [
  "exportPreparationDraftButton",
  "exportPreparationReadyButton",
  "exportPreparationSendButton",
]) {
  assert.equal(html.includes(id), false);
}
console.log("PASS EXP2F2A-10: no mutation controls");

console.log("PASS: Export Preparation Read-only UI v1");
