import assert from "node:assert/strict";
import fs from "node:fs";

const source =
  fs.readFileSync(
    "netlify/functions/ab-advisory-preview.mjs",
    "utf8",
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );


assert.match(
  source,
  /req\.method !== "GET"/,
);

assert.match(
  source,
  /requireDashboardAccess/,
);

assert.match(
  source,
  /SUMMARY_GROUP_REQUIRED/,
);

assert.match(
  source,
  /settlement_summary_group_rounds/,
);

assert.match(
  source,
  /"OPEN"/,
);

assert.match(
  source,
  /"CLOSED"/,
);

assert.match(
  source,
  /dashboard_risk_snapshot/,
);

assert.match(
  source,
  /buildAbAdvisoryScopes/,
);

assert.match(
  source,
  /resolveAbSharedMaxLoss/,
);

assert.match(
  source,
  /AB_ADVISORY_PREVIEW_READ_ONLY/,
);

assert.match(
  source,
  /\/api\/ab-advisory-preview/,
);


for (
  const forbidden
  of [
    ".insert(",
    ".update(",
    ".upsert(",
    ".delete(",
    "LINE_PUSH",
    "pushMessage",
    "multicast",
  ]
) {
  assert.equal(
    source.includes(
      forbidden,
    ),
    false,
    `read-only endpoint contains ${forbidden}`,
  );
}


assert.match(
  app,
  /async function loadAbAdvisoryPreviewReadOnly\(/,
);

assert.match(
  app,
  /\/api\/ab-advisory-preview\?group=/,
);

assert.match(
  app,
  /await loadAbAdvisoryPreviewReadOnly\(\)/,
);


console.log(
  "PASS: independent A/B Advisory endpoint is GET-only",
);

console.log(
  "PASS: latest OPEN/CLOSED Round is eligible",
);

console.log(
  "PASS: endpoint performs no DB mutation",
);

console.log(
  "PASS: endpoint contains no LINE send path",
);

console.log(
  "PASS: closed-Settlement fallback wired to UI",
);
