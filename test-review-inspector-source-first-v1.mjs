import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

assert.match(app, /Review Inspector source-first v1/);
const hs = app.indexOf("verification-inspector-source-first", app.indexOf("function staffVerificationCardHtml("));
const hm = app.indexOf("review-meta staff-verification-meta", app.indexOf("function staffVerificationCardHtml("));
assert.ok(hs >= 0 && hm >= 0 && hs < hm, "Human source must render before metadata");
assert.match(app.slice(hs, hm), /ข้อความต้นฉบับ/);

const lr = app.indexOf("async function loadReviews()");
const li = app.indexOf("reviewImageEvidenceHtml(item)", lr);
const ls = app.indexOf("live-review-source verification-inspector-source-first", lr);
const lm = app.indexOf('<div class="review-meta">', lr);
const le = app.indexOf('class="review-editor"', lr);
assert.ok(li >= 0 && lm >= 0 && li < lm, "Live image must render before metadata");
assert.ok(ls >= 0 && lm >= 0 && ls < lm, "Live text must render before metadata");
assert.ok(le >= 0 && ls < le, "Read-only source must render before editor");
assert.match(styles, /Review Inspector source-first v1/);

console.log("PASS: Review Inspector source-first v1");
