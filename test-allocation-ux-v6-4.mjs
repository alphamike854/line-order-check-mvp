import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./public/styles.css", import.meta.url), "utf8");

assert.match(html, /ทำเพียง 3 ขั้นตอน/);
assert.match(html, /ดูยอดที่ตัดได้/);
assert.match(html, /เลือกรหัส \+ จำนวน/);
assert.match(html, /ตรวจสอบ \+ ยืนยัน/);
assert.match(html, /ตรวจสอบก่อนยืนยัน/);
assert.match(html, /ดูประวัติการตัดยอดในชุดนี้/);

assert.match(app, /ตัดเพิ่มได้อีก/);
assert.match(app, /ดูที่มาของยอดที่ตัดได้/);
assert.match(app, /A \/ B เป็นหมวดหลัก/);
assert.match(app, /หมวดอื่น E \/ F \/ G/);
assert.match(app, /หลังรายการจะตัดได้อีก/);
assert.match(app, /เกินยอดปลอดภัย/);
assert.match(app, /ยืนยันตัดยอด/);
assert.match(app, /\/api\/risk-transfer-preview/);
assert.match(app, /\/api\/risk-transfer-confirm/);
assert.match(app, /TRANSFER_EXCEEDS_SAFE_CAPACITY/);
assert.match(app, /RISK_STATE_STALE/);
assert.match(app, /updateTransferSelectionSummary\(false\)/);

assert.match(css, /\.cut-capacity-card/);
assert.match(css, /\.cut-primary-grid/);
assert.match(css, /\.transfer-selection-bar\.over/);
assert.match(css, /\.transfer-confirm-card/);

console.log("PASS: Simplified three-step allocation UX v6.4 smoke tests");
