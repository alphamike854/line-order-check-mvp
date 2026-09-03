import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const staffMe =
  fs.readFileSync(
    "netlify/functions/staff-me.mjs",
    "utf8",
  );

const staffAccess =
  fs.readFileSync(
    "src/lib/staff-access.mjs",
    "utf8",
  );


// R2D2D-1-01
assert.match(
  staffMe,
  /kind:\s*auth\.actor\.kind/,
  "staff-me must expose authoritative actor.kind",
);


// R2D2D-1-02
const dashboardHeaderPos =
  staffAccess.indexOf(
    '"x-dashboard-key"',
  );

const staffHeaderPos =
  staffAccess.indexOf(
    '"x-staff-key"',
  );

assert.ok(
  dashboardHeaderPos >= 0,
  "Dashboard auth header must exist",
);

assert.ok(
  staffHeaderPos >
    dashboardHeaderPos,
  "Dashboard credential must be evaluated before Staff credential",
);


// R2D2D-1-03
const classifierStart =
  app.indexOf(
    "async function classifyAccessKey",
  );

const apiStart =
  app.indexOf(
    "async function api(",
    classifierStart,
  );

assert.ok(
  classifierStart >= 0
    && apiStart > classifierStart,
  "credential classifier must exist before generic API helper",
);

const classifier =
  app.slice(
    classifierStart,
    apiStart,
  );

assert.match(
  classifier,
  /["']\/api\/staff-me["']/,
  "classification must use staff-me",
);

assert.match(
  classifier,
  /headers\.set\(\s*["']x-dashboard-key["']/,
  "classification must send candidate as Dashboard credential",
);

assert.match(
  classifier,
  /headers\.set\(\s*["']x-staff-key["']/,
  "classification must send candidate as Staff credential",
);


// R2D2D-1-04
assert.match(
  classifier,
  /mode !== ["']DASHBOARD["'][\s\S]*?mode !== ["']STAFF["']/,
  "classifier must accept only explicit DASHBOARD or STAFF mode",
);


// R2D2D-1-05
const authEnterStart =
  app.indexOf(
    "async function authenticateAndEnter",
  );

assert.ok(
  authEnterStart >= 0,
  "authenticateAndEnter must exist",
);

const authEnter =
  app.slice(
    authEnterStart,
    apiStart,
  );

const staffBranchPos =
  authEnter.indexOf(
    'auth.mode === "STAFF"',
  );

const dashboardEnterPos =
  authEnter.indexOf(
    "enterDashboardSession",
  );

assert.ok(
  staffBranchPos >= 0,
  "Staff branch must exist",
);

assert.ok(
  dashboardEnterPos >
    staffBranchPos,
  "Staff must fail closed before Dashboard entry",
);

assert.match(
  authEnter,
  /auth\.mode === ["']STAFF["'][\s\S]*?enterStaffSession/,
  "classified Staff credential must follow explicit Staff entry path",
);

assert.ok(
  authEnter.indexOf(
    "enterStaffSession",
  )
    <
    authEnter.indexOf(
      "enterDashboardSession",
    ),
  "Staff branch must be resolved before Dashboard entry",
);


// R2D2D-1-06
const loginStart =
  app.indexOf(
    'loginForm.addEventListener("submit"',
  );

const logoutStart =
  app.indexOf(
    'logoutButton.addEventListener("click"',
    loginStart,
  );

assert.ok(
  loginStart >= 0
    && logoutStart > loginStart,
  "login/logout handlers must exist",
);

const loginBlock =
  app.slice(
    loginStart,
    logoutStart,
  );

assert.match(
  loginBlock,
  /authenticateAndEnter/,
  "login must classify credential first",
);

assert.doesNotMatch(
  loginBlock,
  /sessionStorage\.setItem/,
  "login handler must not persist unclassified candidate",
);

assert.doesNotMatch(
  loginBlock,
  /loadDashboard\(/,
  "login handler must not call Dashboard directly before classification",
);


// R2D2D-1-07
//
// Generic API credential routing is owned by R2D2D-2.
// R2D2D-1 only requires that credential classification itself
// remains isolated in classifyAccessKey() and happens before
// authenticated application entry.
const genericApi =
  app.slice(
    apiStart,
    app.indexOf(
      "function showLogin",
      apiStart,
    ),
  );

assert.ok(
  genericApi.length > 0,
  "generic API helper must remain present after classification",
);

assert.doesNotMatch(
  genericApi,
  /\/api\/staff-me/,
  "normal API helper must not perform credential classification",
);


// R2D2D-1-08
const startup =
  app.slice(
    app.lastIndexOf(
      "if (state.accessKey)",
    ),
  );

assert.match(
  startup,
  /authenticateAndEnter/,
  "saved credential must be re-classified on startup",
);

assert.doesNotMatch(
  startup,
  /loadDashboard\(\)\.then/,
  "startup must not call Dashboard before credential classification",
);


// R2D2D-1-09
assert.match(
  app,
  /function clearBrowserAuthSession\(\)[\s\S]*?state\.authMode = ""[\s\S]*?state\.actor = null/,
  "auth reset must clear mode and actor",
);


console.log(
  "PASS: R2D2D-1 Browser Credential Classification",
);
