import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("./supabase/migrations/202608260017_allow_close_before_actual_points.sql", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
const specialApi = fs.readFileSync(new URL("./netlify/functions/special-points.mjs", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("./public/index.html", import.meta.url), "utf8");

const closeFn = migration.slice(migration.indexOf("create or replace function public.close_settlement_session"), migration.indexOf("create or replace function public.replace_settlement_actual_special_codes"));
assert.ok(!closeFn.includes("SPECIAL_POINT_CODES_INCOMPLETE"), "close must not require actual Point codes");
assert.ok(closeFn.includes("'point_ready'"), "close result should report whether Point is already ready");

const replaceFn = migration.slice(migration.indexOf("create or replace function public.replace_settlement_actual_special_codes"));
assert.ok(replaceFn.includes("status not in ('OPEN','CLOSED')"), "actual Point codes must be editable for closed settlements");

assert.ok(app.includes('window.confirm("ปิดยอดปัจจุบัน?\\nหลังปิดยังระบุ Point ได้")'), "close confirmation should be one-click and explain Point can follow later");
assert.ok(!app.includes('กำหนด Point ให้ครบก่อนปิดยอด'), "UI must not block close on Point readiness");
assert.ok(app.includes('finalReady?formatNumber(g.special_point_total):"รอระบุ"'), "pending report must not display Point zero as final");
assert.ok(app.includes('finalReady?formatNumber(g.reconciliation_total):"—"'), "pending report must not display a misleading final reconciliation total");
assert.ok(app.includes('edit-report-points'), "closed report should expose a Point action");
assert.ok(app.includes('settlement_session_id:sessionId'), "Point save must target the selected settlement explicitly");
assert.ok(specialApi.includes('session.status === "OPEN" ? session : null'), "special Point API should preserve open_session backward compatibility");
assert.ok(specialApi.includes('body.settlement_session_id'), "special Point API must support a closed settlement id");
assert.ok(html.includes('id="specialPointContext"'), "Point page should show which settlement is being edited");

console.log("PASS: one-click close + Point later v7.4 smoke tests");
