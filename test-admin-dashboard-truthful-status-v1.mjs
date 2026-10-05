import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const dashboard =
  fs.readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  );

const dashboardApi =
  fs.readFileSync(
    "src/lib/dashboard-api.mjs",
    "utf8",
  );

function functionBlock(
  source,
  name,
) {
  const pattern =
    new RegExp(
      `(?:async\\s+)?function\\s+${name}\\s*\\(`,
    );

  const match =
    pattern.exec(source);

  assert.ok(
    match,
    `missing function ${name}`,
  );

  const start =
    match.index;

  const rest =
    source.slice(
      start + match[0].length,
    );

  const next =
    /\n(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/.exec(
      rest,
    );

  const end =
    next
      ? start
        + match[0].length
        + next.index
      : source.length;

  return source.slice(
    start,
    end,
  );
}

console.log(
  "===== Admin Dashboard Truthful Status v1 =====",
);

// ------------------------------------------------------------
// ADT-01 — Review badge remains authoritative Dashboard metric.
// ------------------------------------------------------------

const renderMetrics =
  functionBlock(
    app,
    "renderMetrics",
  );

assert.match(
  renderMetrics,
  /#reviewBadge/,
);

assert.match(
  renderMetrics,
  /metrics\.review_open/,
);

assert.match(
  dashboard,
  /fetchOpenReviewCount/,
);

assert.match(
  dashboard,
  /review_open:Number\(reviewOpenCount\|\|0\)/,
);

console.log(
  "PASS ADT-01: authoritative Review count preserved",
);

// ------------------------------------------------------------
// ADT-02 — Dashboard bootstrap no longer performs unused
// UNSEND detail read.
// ------------------------------------------------------------

assert.doesNotMatch(
  dashboard,
  /fetchUnsends/,
);

assert.doesNotMatch(
  dashboard,
  /\bunsends\b/,
);

assert.match(
  dashboardApi,
  /export async function fetchUnsends\(/,
);

console.log(
  "PASS ADT-02: unused Dashboard UNSEND read removed while helper remains",
);

// ------------------------------------------------------------
// ADT-03 — Dashboard starts with UNSEND badge untrusted/hidden.
// ------------------------------------------------------------

const hideUnsendBadge =
  functionBlock(
    app,
    "hideUnsendBadgeUntilLoaded",
  );

assert.match(
  hideUnsendBadge,
  /#unsendBadge/,
);

assert.match(
  hideUnsendBadge,
  /classList\.add\([\s\S]*?"hidden"/,
);

assert.doesNotMatch(
  hideUnsendBadge,
  /#reviewBadge/,
);

const dashboardEntry =
  functionBlock(
    app,
    "enterDashboardSession",
  );

assert.match(
  dashboardEntry,
  /hideUnsendBadgeUntilLoaded\(\)/,
);

console.log(
  "PASS ADT-03: Admin UNSEND badge begins hidden without affecting Review",
);

// ------------------------------------------------------------
// ADT-04 — every Dashboard reload invalidates stale UNSEND count.
// ------------------------------------------------------------

const loadDashboard =
  functionBlock(
    app,
    "loadDashboard",
  );

const hidePosition =
  loadDashboard.indexOf(
    "hideUnsendBadgeUntilLoaded();",
  );

const apiPosition =
  loadDashboard.indexOf(
    "/api/dashboard?",
  );

assert.ok(
  hidePosition >= 0
  && apiPosition > hidePosition,
  "UNSEND badge must hide before Dashboard request",
);

console.log(
  "PASS ADT-04: stale UNSEND count is invalidated before Dashboard reload",
);

// ------------------------------------------------------------
// ADT-05 — only successful /api/unsends read reveals count.
// ------------------------------------------------------------

const loadUnsends =
  functionBlock(
    app,
    "loadUnsends",
  );

const unsendFetch =
  loadUnsends.indexOf(
    "/api/unsends?",
  );

const unsendCount =
  loadUnsends.indexOf(
    "payload.items.length",
  );

const reveal =
  loadUnsends.indexOf(
    'classList.remove(\n        "hidden"',
  );

assert.ok(
  unsendFetch >= 0,
  "UNSEND endpoint missing",
);

assert.ok(
  unsendCount > unsendFetch,
  "UNSEND count must come after successful API read",
);

assert.ok(
  reveal > unsendCount,
  "UNSEND badge must reveal only after authoritative count",
);

assert.match(
  loadUnsends,
  /classList\.add\([\s\S]*?"hidden"/,
);

console.log(
  "PASS ADT-05: UNSEND zero is shown only after authoritative load",
);

// ------------------------------------------------------------
// ADT-06 — Admin header has explicit loading and failure states.
// ------------------------------------------------------------

assert.match(
  loadDashboard,
  /กำลังโหลดข้อมูล\.\.\./,
);

assert.match(
  loadDashboard,
  /กำลังอัปเดตข้อมูล\.\.\./,
);

assert.match(
  loadDashboard,
  /dashboardMetricsRendered/,
);

assert.match(
  loadDashboard,
  /โหลดข้อมูลไม่สำเร็จ/,
);

assert.match(
  renderMetrics,
  /#freshness/,
);

assert.match(
  renderMetrics,
  /ล่าสุด/,
);

console.log(
  "PASS ADT-06: Admin loading/success/failure header states are explicit",
);

// ------------------------------------------------------------
// ADT-07 — freshness remains manual-stale, not auto rebuild.
// ------------------------------------------------------------

const freshness =
  functionBlock(
    app,
    "checkFreshness",
  );

assert.match(
  freshness,
  /setDashboardStale\(true\)/,
);

assert.doesNotMatch(
  freshness,
  /loadDashboard\(\{\s*silent:\s*true/,
);

assert.doesNotMatch(
  freshness,
  /loadReport\(\{\s*silent:\s*true/,
);

console.log(
  "PASS ADT-07: manual stale/freshness policy preserved",
);

console.log(
  "PASS: Admin Dashboard Truthful Status v1",
);
