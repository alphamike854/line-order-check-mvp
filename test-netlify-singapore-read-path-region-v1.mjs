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

// Wave 1 excluded settlement and webhook. Wave 2 now relocates only the
// public LINE ingress gateway, alongside the existing Singapore QStash consumer.
const settlementSource =
  fs.readFileSync("netlify/functions/settlement.mjs", "utf8");

assert.doesNotMatch(
  settlementSource,
  /\bregion\s*:\s*["']sin["']/,
  "settlement must remain outside Wave 1",
);
console.log("PASS REG1-02: settlement remains outside Wave 1");

const ingressSource =
  fs.readFileSync("netlify/functions/line-webhook.mjs", "utf8");

assert.match(
  ingressSource,
  /export\s+const\s+config\s*=\s*\{\s*path:\s*"\/api\/line-webhook",\s*region:\s*"sin",\s*\};/,
  "public LINE webhook ingress gateway must explicitly run in Singapore",
);
console.log("PASS REG2-01: LINE webhook ingress region is sin");

const consumerSource =
  fs.readFileSync("netlify/functions/line-webhook-qstash.mjs", "utf8");
assert.match(
  consumerSource,
  /export\s+const\s+config\s*=\s*\{[\s\S]*?region:\s*"sin"[\s\S]*?\};/,
  "QStash consumer Singapore region must remain unchanged",
);
console.log("PASS REG2-02: QStash consumer Singapore region retained");

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
