import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
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


// ============================================================
// R2D2D-3-01 — Staff entry is distinct from Dashboard entry.
// ============================================================

const staffEntry =
  sliceBetween(
    app,
    "async function enterStaffSession",
    "async function enterDashboardSession",
  );

assert.ok(
  staffEntry.includes(
    'auth.mode !== "STAFF"',
  ),
  "Staff entry must require STAFF mode",
);

assert.ok(
  staffEntry.includes(
    "!auth.actor?.staff_id",
  ),
  "Staff entry must require real Staff identity",
);

assert.ok(
  staffEntry.includes(
    "persistBrowserAuthSession",
  ),
  "Staff entry must persist classified credential",
);

assert.ok(
  staffEntry.includes(
    "configureAppForAuthMode",
  )
    && staffEntry.includes(
      '"STAFF"',
    ),
  "Staff entry must select Staff shell",
);

assert.ok(
  staffEntry.includes(
    "selectTabUi",
  )
    && staffEntry.includes(
      '"review"',
    ),
  "Staff entry must select Review tab",
);

assert.ok(
  staffEntry.includes(
    "await loadReviews();",
  ),
  "Staff entry must load Review workbench",
);

assert.ok(
  !staffEntry.includes(
    "loadDashboard(",
  ),
  "Staff entry must not load Dashboard",
);

assert.ok(
  !staffEntry.includes(
    "startFreshnessPolling",
  ),
  "Staff entry must not start Dashboard freshness polling",
);


// ============================================================
// R2D2D-3-02 — Staff shell removes Dashboard operational UI.
// ============================================================

const shell =
  sliceBetween(
    app,
    "function configureAppForAuthMode",
    "function selectTabUi",
  );

for (
  const selector of [
    "#settlementPanel",
    ".operational-filters",
    "#staleBanner",
    "#metrics",
  ]
) {
  assert.ok(
    shell.includes(
      selector,
    ),
    `Staff shell must control ${selector}`,
  );
}

assert.ok(
  shell.includes(
    "tab.dataset.tab",
  ),
  "Staff shell must inspect tab identity",
);

assert.ok(
  shell.includes(
    '!== "review"',
  ),
  "Staff shell must retain Review tab only",
);


// ============================================================
// R2D2D-3-03 — Staff Review read is server scoped.
// ============================================================

const loadReviews =
  sliceBetween(
    app,
    "async function loadReviews",
    "async function loadUnsends",
  );

assert.ok(
  loadReviews.includes(
    'state.authMode === "STAFF"',
  ),
  "Review loader must branch on Staff mode",
);

assert.ok(
  loadReviews.includes(
    "/api/staff-reviews?",
  ),
  "Staff Review must use /api/staff-reviews",
);

assert.ok(
  loadReviews.includes(
    "/api/reviews?",
  ),
  "Dashboard legacy Review path must remain",
);

assert.ok(
  loadReviews.includes(
    "/api/staff-workbench?",
  ),
  "Review loader must retain authoritative workbench claim state",
);


// ============================================================
// R2D2D-3-04 — Staff branch returns before Dashboard fallback.
// ============================================================

const authBlock =
  sliceBetween(
    app,
    "async function authenticateAndEnter",
    "async function api(",
  );

const staffModePos =
  authBlock.indexOf(
    'auth.mode === "STAFF"',
  );

const staffEnterPos =
  authBlock.indexOf(
    "enterStaffSession",
    staffModePos,
  );

const staffReturnPos =
  authBlock.indexOf(
    "return true;",
    staffEnterPos,
  );

const dashboardEnterPos =
  authBlock.indexOf(
    "enterDashboardSession",
    staffReturnPos,
  );

assert.ok(
  staffModePos >= 0
    && staffEnterPos > staffModePos
    && staffReturnPos > staffEnterPos
    && dashboardEnterPos > staffReturnPos,
  "Staff must complete Staff entry before Dashboard fallback",
);

const staffBranchOnly =
  authBlock.slice(
    staffModePos,
    staffReturnPos,
  );

assert.ok(
  !staffBranchOnly.includes(
    "enterDashboardSession",
  ),
  "Staff branch must not enter Dashboard session",
);


// ============================================================
// R2D2D-3-05 — Staff cannot activate Dashboard tabs.
// ============================================================

const activateTab =
  sliceBetween(
    app,
    "function activateTab",
    'loginForm.addEventListener("submit"',
  );

const modeGuardPos =
  activateTab.indexOf(
    'state.authMode === "STAFF"',
  );

const reviewGuardPos =
  activateTab.indexOf(
    'name !== "review"',
    modeGuardPos,
  );

const returnPos =
  activateTab.indexOf(
    "return;",
    reviewGuardPos,
  );

const selectPos =
  activateTab.indexOf(
    "selectTabUi(name)",
    returnPos,
  );

assert.ok(
  modeGuardPos >= 0
    && reviewGuardPos > modeGuardPos
    && returnPos > reviewGuardPos
    && selectPos > returnPos,
  "Staff must be rejected before activating non-Review tabs",
);


// ============================================================
// R2D2D-3-06 — Refresh is mode aware.
// ============================================================

const refreshStart =
  app.indexOf(
    'refreshButton.addEventListener(',
  );

assert.ok(
  refreshStart >= 0,
  "Refresh handler must exist",
);

const staleRefreshStart =
  app.indexOf(
    '$("#staleRefreshButton")',
    refreshStart,
  );

assert.ok(
  staleRefreshStart > refreshStart,
  "Refresh handler boundary must exist",
);

const refreshBlock =
  app.slice(
    refreshStart,
    staleRefreshStart,
  );

const refreshStaffPos =
  refreshBlock.indexOf(
    'state.authMode === "STAFF"',
  );

const refreshReviewsPos =
  refreshBlock.indexOf(
    "loadReviews();",
    refreshStaffPos,
  );

const refreshReturnPos =
  refreshBlock.indexOf(
    "return;",
    refreshReviewsPos,
  );

const refreshDashboardPos =
  refreshBlock.indexOf(
    "loadDashboard();",
    refreshReturnPos,
  );

assert.ok(
  refreshStaffPos >= 0
    && refreshReviewsPos > refreshStaffPos
    && refreshReturnPos > refreshReviewsPos
    && refreshDashboardPos > refreshReturnPos,
  "Staff refresh must reload Review and return before Dashboard refresh",
);


// ============================================================
// R2D2D-3-07 — Hidden Dashboard filters cannot invoke Dashboard.
// ============================================================

const groupChangeStart =
  app.indexOf(
    'summaryGroupSelect.addEventListener("change"',
  );

assert.ok(
  groupChangeStart >= 0,
  "Summary Group change handler must exist",
);

const tabsBindStart =
  app.indexOf(
    '$$(".tab").forEach',
    groupChangeStart,
  );

assert.ok(
  tabsBindStart > groupChangeStart,
  "Summary Group handler boundary must exist",
);

const groupChange =
  app.slice(
    groupChangeStart,
    tabsBindStart,
  );

const groupStaffPos =
  groupChange.indexOf(
    'state.authMode === "STAFF"',
  );

const groupReturnPos =
  groupChange.indexOf(
    "return;",
    groupStaffPos,
  );

const groupDashboardPos =
  groupChange.indexOf(
    "loadDashboard();",
    groupReturnPos,
  );

assert.ok(
  groupStaffPos >= 0
    && groupReturnPos > groupStaffPos
    && groupDashboardPos > groupReturnPos,
  "Staff must return before hidden Dashboard filter can refresh Dashboard",
);


console.log(
  "PASS: R2D2D-3 Staff-only Review Workbench Shell",
);
