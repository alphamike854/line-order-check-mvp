import fs from "node:fs";
import assert from "node:assert/strict";

console.log(
  "===== Netlify Singapore Read Path Region v1 =====",
);

const targets = new Map([
  [
    "netlify/functions/dashboard-freshness.mjs",
    "/api/dashboard-freshness",
  ],
  [
    "netlify/functions/staff-me.mjs",
    "/api/staff-me",
  ],
  [
    "netlify/functions/staff-reviews.mjs",
    "/api/staff-reviews",
  ],
  [
    "netlify/functions/staff-workbench.mjs",
    "/api/staff-workbench",
  ],
  [
    "netlify/functions/staff-verification-message.mjs",
    "/api/staff-verification-message",
  ],
  [
    "netlify/functions/accounting-report.mjs",
    "/api/accounting-report",
  ],
]);

for (const [file, route] of targets) {
  const source =
    fs.readFileSync(file, "utf8");

  assert.match(
    source,
    new RegExp(
      String.raw`export\s+const\s+config\s*=\s*\{`
      + String.raw`[\s\S]*?`
      + route.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        )
      + String.raw`[\s\S]*?`
      + String.raw`region\s*:\s*["']sin["']`
      + String.raw`[\s\S]*?\};`,
    ),
    `${file} must retain ${route} and run in sin`,
  );
}

console.log(
  "PASS REG1-01: all six Wave 1 read paths declare sin",
);

for (const file of [
  "netlify/functions/settlement.mjs",
  "netlify/functions/line-webhook.mjs",
]) {
  const source =
    fs.readFileSync(file, "utf8");

  assert.doesNotMatch(
    source,
    /\bregion\s*:\s*["']sin["']/,
    `${file} must remain outside Wave 1`,
  );
}

console.log(
  "PASS REG1-02: settlement and LINE webhook remain outside Wave 1",
);

const dashboard =
  fs.readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  );

assert.match(
  dashboard,
  /\bregion\s*:\s*["']sin["']/,
  "existing Dashboard Singapore placement must remain",
);

console.log(
  "PASS REG1-03: existing Dashboard sin placement retained",
);

console.log(
  "PASS: Netlify Singapore Read Path Region v1",
);
