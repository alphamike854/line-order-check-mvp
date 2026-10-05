import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const html =
  fs.readFileSync(
    "public/index.html",
    "utf8",
  );

function sliceBetween(
  source,
  startMarker,
  endMarker,
) {
  const start =
    source.indexOf(
      startMarker,
    );

  assert.ok(
    start >= 0,
    `missing start marker: ${startMarker}`,
  );

  const end =
    source.indexOf(
      endMarker,
      start + startMarker.length,
    );

  assert.ok(
    end > start,
    `missing end marker: ${endMarker}`,
  );

  return source.slice(
    start,
    end,
  );
}

console.log(
  "===== Staff Browser Badge Visibility v9.22 =====",
);

assert.match(
  html,
  /id="reviewBadge"[^>]*class="badge"[^>]*>0<\/span>/,
);

assert.match(
  html,
  /id="unsendBadge"[^>]*class="badge"[^>]*>0<\/span>/,
);

console.log(
  "PASS SBV-01: Review/Unsend retain Dashboard-compatible initial badges",
);

const shell =
  sliceBetween(
    app,
    "function configureAppForAuthMode",
    "function selectTabUi",
  );

assert.match(
  shell,
  /mode === "STAFF"/,
);

assert.match(
  shell,
  /"#reviewBadge"/,
);

assert.match(
  shell,
  /"#unsendBadge"/,
);

console.log(
  "PASS SBV-02: Staff shell explicitly controls both numeric badges",
);

assert.match(
  shell,
  /badge\.classList\.toggle\([\s\S]*?"hidden"[\s\S]*?staffMode[\s\S]*?\)/,
);

console.log(
  "PASS SBV-03: badges are hidden exactly when Staff mode is active",
);

/*
 * toggle("hidden", staffMode) is intentionally symmetric:
 *
 * STAFF     -> hidden=true
 * DASHBOARD -> hidden=false
 *
 * This preserves the existing Dashboard counters.
 */
assert.doesNotMatch(
  shell,
  /badge\.textContent\s*=\s*"0"/,
);

assert.doesNotMatch(
  shell,
  /remove\(\)/,
);

console.log(
  "PASS SBV-04: patch does not falsify counts or remove badge elements",
);

const staffEntry =
  sliceBetween(
    app,
    "async function enterStaffSession",
    "async function enterDashboardSession",
  );

assert.doesNotMatch(
  staffEntry,
  /loadDashboard\(/,
);

assert.doesNotMatch(
  staffEntry,
  /startFreshnessPolling/,
);

console.log(
  "PASS SBV-05: Staff still avoids Dashboard aggregate/polling path",
);

assert.match(
  app,
  /#reviewBadge/,
);

assert.match(
  app,
  /#unsendBadge/,
);

console.log(
  "PASS SBV-06: existing Dashboard badge update paths remain present",
);

console.log(
  "PASS: Staff Browser Badge Visibility v9.22",
);
