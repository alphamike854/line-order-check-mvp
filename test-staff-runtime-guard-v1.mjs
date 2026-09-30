import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const packageJson =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

function section(
  source,
  startToken,
  endToken,
) {
  const start =
    source.indexOf(
      startToken,
    );

  const end =
    source.indexOf(
      endToken,
      start + startToken.length,
    );

  assert.ok(
    start >= 0
      && end > start,
    `cannot isolate ${startToken}`,
  );

  return source.slice(
    start,
    end,
  );
}

console.log(
  "===== Staff Runtime Guard V1 =====",
);

const bridge =
  section(
    app,
    "async function openReportMessageInReview(",
    "function bindReportReviewMessageBridge(",
  );

assert.match(
  bridge,
  /state\.authMode === "STAFF"[\s\S]*?state\.reportPayload\?\.session\?\.id/,
);
console.log(
  "PASS SRG-01: Staff Report bridge uses server-resolved Report session",
);

assert.match(
  bridge,
  /state\.reportPayload\?\.session\?\.status === "OPEN"/,
);
console.log(
  "PASS SRG-02: Staff Report bridge requires OPEN session",
);

assert.match(
  bridge,
  /state\.settlement\?\.open_session\?\.id/,
);
console.log(
  "PASS SRG-03: Dashboard current-session source retained",
);

assert.match(
  bridge,
  /reportSessionId[\s\S]*?!==\s*currentOpenSessionId/,
);

assert.match(
  bridge,
  /รายการนี้เป็นรายงานย้อนหลัง/,
);
console.log(
  "PASS SRG-04: historical Report still fails closed",
);

const applyReview =
  section(
    app,
    "async function applyReview(card)",
    "async function ignoreReview(event)",
  );

const ignoreReview =
  section(
    app,
    "async function ignoreReview(event)",
    "// ============================================================\n// C3B-3 Human Verification Correction Browser",
  );

for (
  const [
    label,
    block,
  ] of [
    ["CORRECT", applyReview],
    ["IGNORE", ignoreReview],
  ]
) {
  assert.match(
    block,
    /\/api\/review-resolve/,
    `${label} must retain audited resolve endpoint`,
  );

  assert.match(
    block,
    /if\s*\(\s*state\.authMode === "DASHBOARD"\s*\)\s*\{[\s\S]*?await loadDashboard\(\{/,
    `${label} Dashboard refresh must be Dashboard-only`,
  );

  assert.equal(
    (
      block.match(
        /await loadDashboard\(\{/g,
      )
      || []
    ).length,
    1,
    `${label} must have exactly one Dashboard refresh`,
  );
}

console.log(
  "PASS SRG-05: CORRECT cannot call Dashboard refresh in Staff mode",
);

console.log(
  "PASS SRG-06: IGNORE cannot call Dashboard refresh in Staff mode",
);

assert.ok(
  packageJson.includes(
    "test-staff-runtime-guard-v1.mjs",
  ),
  "Staff runtime guard test must join npm test",
);

console.log(
  "PASS SRG-07: regression joined full suite",
);

console.log(
  "PASS: Staff Runtime Guard V1",
);
