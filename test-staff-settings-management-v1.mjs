import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";

// staff-settings.mjs imports dashboard-api.mjs, which constructs the
// Supabase client at module load time. This contract test never performs
// a DB request, so provide process-local dummy values before dynamic import.
process.env.SUPABASE_URL ||= "https://test-only.supabase.co";
process.env.SUPABASE_SECRET_KEY ||= "test-only-secret-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-only-service-role-key";
process.env.SUPABASE_ANON_KEY ||= "test-only-anon-key";

const {
  generateStaffAccessKey,
  normalizeAssignmentRole,
  normalizeDisplayName,
  normalizeStaffCode,
  normalizeStaffRole,
} = await import(
  "./netlify/functions/staff-settings.mjs"
);

const api =
  readFileSync(
    "netlify/functions/staff-settings.mjs",
    "utf8",
  );

const html =
  readFileSync(
    "public/index.html",
    "utf8",
  );

const app =
  readFileSync(
    "public/app.js",
    "utf8",
  );

const css =
  readFileSync(
    "public/styles.css",
    "utf8",
  );

assert.equal(
  normalizeStaffCode(" staff01 "),
  "STAFF01",
);

assert.equal(
  normalizeDisplayName(" Staff One "),
  "Staff One",
);

assert.equal(
  normalizeStaffRole("supervisor"),
  "SUPERVISOR",
);

assert.equal(
  normalizeAssignmentRole("reviewer"),
  "REVIEWER",
);

assert.throws(
  () =>
    normalizeStaffCode(""),
  /INVALID_STAFF_CODE/,
);

assert.throws(
  () =>
    normalizeStaffRole("OWNER"),
  /INVALID_STAFF_ROLE/,
);

const keyA =
  generateStaffAccessKey();

const keyB =
  generateStaffAccessKey();

assert.ok(
  keyA.length >= 40,
);

assert.notEqual(
  keyA,
  keyB,
);

assert.match(
  api,
  /requireDashboardAccess\(req\)/,
);

assert.match(
  api,
  /hashStaffAccessKey/,
);

assert.match(
  api,
  /randomBytes\(32\)/,
);

assert.match(
  api,
  /"CREATE"/,
);

assert.match(
  api,
  /"RESET_KEY"/,
);

assert.match(
  api,
  /"SET_ENABLED"/,
);

assert.match(
  api,
  /"SET_ASSIGNMENT"/,
);

assert.match(
  api,
  /ADMIN_ASSIGNMENT_NOT_REQUIRED/,
);

assert.match(
  api,
  /key_delivery:\s*"ONE_TIME"/,
);

assert.match(
  api,
  /staff_accounts/,
);

assert.match(
  api,
  /line_group_staff_assignments/,
);

// GET/read projections must not expose the key hash.
const readSection =
  api.slice(
    api.indexOf(
      "async function readStaffSettings",
    ),
    api.indexOf(
      "async function createStaff",
    ),
  );

assert.equal(
  readSection.includes(
    "access_key_hash",
  ),
  false,
);

assert.match(
  html,
  /id="staffCreateForm"/,
);

assert.match(
  html,
  /id="staffAccountsList"/,
);

assert.match(
  html,
  /id="staffIssuedKey"/,
);

assert.match(
  html,
  /แสดงครั้งเดียว/,
);

assert.match(
  app,
  /\/api\/staff-settings/,
);

assert.match(
  app,
  /renderStaffSettings/,
);

assert.match(
  app,
  /SET_ASSIGNMENT/,
);

assert.match(
  app,
  /RESET_KEY/,
);

assert.match(
  app,
  /SET_ENABLED/,
);

assert.match(
  css,
  /\.staff-account-card/,
);

assert.match(
  css,
  /\.staff-key-notice/,
);

console.log(
  "PASS: Staff Settings Management V1 contract",
);
