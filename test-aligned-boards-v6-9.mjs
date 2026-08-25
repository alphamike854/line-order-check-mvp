import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");
const historyApi = fs.readFileSync("netlify/functions/allocation-history.mjs", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert.equal(pkg.version, "0.7.9");
assert.match(pkg.scripts.test, /test-aligned-boards-v6-9\.mjs/);
assert.match(html, /data-tab="summary"[\s\S]*data-tab="allocation"[\s\S]*data-tab="postcut"/);
assert.match(html, /id="postcutTab"/);
assert.match(html, /id="postCutBoard"/);
assert.match(app, /function renderPostCutCategoryColumn/);
assert.match(app, /function renderPostCutGroupBoard/);
assert.match(app, /function renderAfterCut/);
assert.match(app, /class="four-column-board"/);
assert.match(app, /round-chip/);
assert.match(app, /state\.allocationHistory=payload\.history\|\|\[\]/);
assert.match(app, /activeTab === "postcut"/);
assert.match(css, /v6\.9: aligned Summary \/ Allocation \/ After-cut boards/);
assert.match(css, /\.board-code-main\{display:grid;grid-template-columns:minmax\(34px,max-content\) minmax\(58px,max-content\);justify-content:start/);
assert.match(css, /\.round-chip\{/);
assert.match(historyApi, /limit\(500\)/);
console.log("PASS: Aligned Summary + Allocation + After-cut board v6.9 smoke tests");
