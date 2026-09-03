import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );


// R2D2D-2-01
assert.match(
  app,
  /const ACCESS_KEY_STORAGE\s*=\s*["']lineOrderAccessKey["']/,
  "generic Access Key storage must exist",
);

assert.match(
  app,
  /LEGACY_DASHBOARD_ACCESS_KEY_STORAGE\s*=\s*["']lineOrderDashboardKey["']/,
  "legacy Dashboard storage must remain as migration fallback",
);


// R2D2D-2-02
assert.match(
  app,
  /sessionStorage\.getItem\(\s*ACCESS_KEY_STORAGE[\s\S]*?sessionStorage\.getItem\(\s*LEGACY_DASHBOARD_ACCESS_KEY_STORAGE/,
  "startup must prefer generic key then legacy Dashboard fallback",
);


// R2D2D-2-03
const clearStart =
  app.indexOf(
    "function clearBrowserAuthSession",
  );

const persistStart =
  app.indexOf(
    "function persistBrowserAuthSession",
  );

const classifyStart =
  app.indexOf(
    "async function classifyAccessKey",
  );

assert.ok(
  clearStart >= 0
    && persistStart > clearStart
    && classifyStart > persistStart,
  "auth session helpers must exist before classifier",
);

const clearBlock =
  app.slice(
    clearStart,
    persistStart,
  );

assert.match(
  clearBlock,
  /removeItem\(\s*ACCESS_KEY_STORAGE/,
  "logout must clear generic Access Key storage",
);

assert.match(
  clearBlock,
  /removeItem\(\s*LEGACY_DASHBOARD_ACCESS_KEY_STORAGE/,
  "logout must clear legacy Dashboard storage",
);


// R2D2D-2-04
const persistBlock =
  app.slice(
    persistStart,
    classifyStart,
  );

assert.match(
  persistBlock,
  /mode !== ["']DASHBOARD["'][\s\S]*?mode !== ["']STAFF["']/,
  "only authoritative DASHBOARD/STAFF modes may be persisted in memory",
);

assert.match(
  persistBlock,
  /sessionStorage\.setItem\(\s*ACCESS_KEY_STORAGE,\s*accessKey/,
  "generic credential must use new Access Key storage",
);

assert.doesNotMatch(
  persistBlock,
  /sessionStorage\.setItem\([\s\S]{0,120}authMode/,
  "auth mode must never be persisted to sessionStorage",
);

assert.match(
  persistBlock,
  /removeItem\(\s*LEGACY_DASHBOARD_ACCESS_KEY_STORAGE/,
  "successful classified session migrates away from legacy storage",
);


// R2D2D-2-05
const apiStart =
  app.indexOf(
    "async function api(",
  );

const showLoginStart =
  app.indexOf(
    "function showLogin",
    apiStart,
  );

assert.ok(
  apiStart >= 0
    && showLoginStart > apiStart,
  "generic API helper must exist",
);

const apiBlock =
  app.slice(
    apiStart,
    showLoginStart,
  );

assert.match(
  apiBlock,
  /state\.authMode === ["']DASHBOARD["'][\s\S]*?headers\.set\(\s*["']x-dashboard-key["']/,
  "Dashboard mode must send Dashboard header",
);

assert.match(
  apiBlock,
  /state\.authMode === ["']STAFF["'][\s\S]*?headers\.set\(\s*["']x-staff-key["']/,
  "Staff mode must send Staff header",
);


// R2D2D-2-06
assert.match(
  apiBlock,
  /x-dashboard-key[\s\S]*?headers\.delete\(\s*["']x-staff-key["']/,
  "Dashboard request must remove any Staff credential header",
);

assert.match(
  apiBlock,
  /x-staff-key[\s\S]*?headers\.delete\(\s*["']x-dashboard-key["']/,
  "Staff request must remove any Dashboard credential header",
);


// R2D2D-2-07
assert.match(
  apiBlock,
  /AUTH_MODE_REQUIRED/,
  "generic API must fail closed before credential classification",
);


// R2D2D-2-08
const enterDashboardStart =
  app.indexOf(
    "async function enterDashboardSession",
  );

const authenticateStart =
  app.indexOf(
    "async function authenticateAndEnter",
  );

const enterDashboardBlock =
  app.slice(
    enterDashboardStart,
    authenticateStart,
  );

assert.match(
  enterDashboardBlock,
  /auth\.mode !== ["']DASHBOARD["']/,
  "Dashboard entry must explicitly require Dashboard mode",
);

assert.match(
  enterDashboardBlock,
  /persistBrowserAuthSession/,
  "Dashboard entry must use generic classified-session persistence",
);

assert.doesNotMatch(
  enterDashboardBlock,
  /lineOrderDashboardKey/,
  "Dashboard entry must no longer directly use legacy storage",
);


// R2D2D-2-09
const authenticateBlock =
  app.slice(
    authenticateStart,
    apiStart,
  );

assert.match(
  authenticateBlock,
  /auth\.mode === ["']STAFF["'][\s\S]*?enterStaffSession/,
  "Staff classification must route to the Staff application entry",
);

const staffModePos =
  authenticateBlock.indexOf(
    'auth.mode === "STAFF"',
  );

const staffEntryPos =
  authenticateBlock.indexOf(
    "enterStaffSession",
    staffModePos,
  );

const staffReturnPos =
  authenticateBlock.indexOf(
    "return true;",
    staffEntryPos,
  );

const dashboardFallbackPos =
  authenticateBlock.indexOf(
    "enterDashboardSession",
    staffReturnPos,
  );

assert.ok(
  staffModePos >= 0
    && staffEntryPos > staffModePos
    && staffReturnPos > staffEntryPos
    && dashboardFallbackPos > staffReturnPos,
  "Staff entry must complete and return before Dashboard fallback",
);

const staffBranchOnly =
  authenticateBlock.slice(
    staffModePos,
    staffReturnPos,
  );

assert.doesNotMatch(
  staffBranchOnly,
  /enterDashboardSession/,
  "Staff branch itself must never enter Dashboard session",
);


// R2D2D-2-10
assert.doesNotMatch(
  app,
  /sessionStorage\.setItem\(\s*["']lineOrderAuthMode["']/,
  "browser must never persist an auth mode assertion",
);


console.log(
  "PASS: R2D2D-2 Mode-aware Browser API",
);
