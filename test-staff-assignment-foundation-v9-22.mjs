import assert from "node:assert/strict";

import {
  createHash,
} from "node:crypto";

import {
  readFile,
} from "node:fs/promises";

import {
  hashStaffAccessKey,
} from "./src/lib/staff-access.mjs";

const migration =
  await readFile(
    "supabase/migrations/20260902065000_add_staff_line_group_assignment_foundation.sql",
    "utf8",
  );

const access =
  await readFile(
    "src/lib/staff-access.mjs",
    "utf8",
  );

const api =
  await readFile(
    "netlify/functions/staff-me.mjs",
    "utf8",
  );

assert.match(
  migration,
  /create table if not exists public\.staff_accounts/i,
  "R2D1A-01 staff_accounts exists",
);

assert.match(
  migration,
  /create table if not exists public\.line_group_staff_assignments/i,
  "R2D1A-02 assignment table exists",
);

assert.match(
  migration,
  /primary key\s*\(\s*line_group_id,\s*staff_id\s*\)/i,
  "R2D1A-03 assignment supports many-to-many ownership",
);

assert.match(
  migration,
  /references public\.line_groups\(line_group_id\)/i,
  "R2D1A-04 assignment references LINE Group",
);

assert.match(
  migration,
  /references public\.staff_accounts\(id\)/i,
  "R2D1A-05 assignment references Staff",
);

assert.match(
  migration,
  /role in\s*\(\s*'ADMIN',\s*'SUPERVISOR',\s*'STAFF'/i,
  "R2D1A-06 staff roles are explicit",
);

assert.match(
  migration,
  /assignment_role in\s*\(\s*'REVIEWER',\s*'SUPERVISOR'/i,
  "R2D1A-07 assignment roles are explicit",
);

assert.match(
  migration,
  /access_key_hash ~ '\^\[0-9a-f\]\{64\}\$'/i,
  "R2D1A-08 access key hash is SHA-256 shaped",
);

assert.match(
  migration,
  /enable row level security/i,
  "R2D1A-09 RLS enabled",
);

assert.match(
  migration,
  /revoke all[\s\S]*from anon, authenticated/i,
  "R2D1A-10 browser roles do not receive direct table access",
);

const expectedHash =
  createHash("sha256")
    .update(
      "staff-secret",
      "utf8",
    )
    .digest("hex");

assert.equal(
  hashStaffAccessKey(
    "staff-secret",
  ),
  expectedHash,
  "R2D1A-11 staff access keys hash deterministically",
);

assert.equal(
  hashStaffAccessKey(""),
  null,
  "R2D1A-12 empty access key is rejected",
);

assert.match(
  access,
  /x-dashboard-key/i,
  "R2D1A-13 legacy dashboard admin compatibility remains",
);

assert.match(
  access,
  /x-staff-key/i,
  "R2D1A-14 staff uses independent per-user access key",
);

assert.match(
  access,
  /\.from\("staff_accounts"\)/,
  "R2D1A-15 server resolves Staff from database identity",
);

assert.match(
  access,
  /\.from\(\s*"line_group_staff_assignments"/,
  "R2D1A-16 Staff LINE Group scope comes from assignment table",
);

assert.match(
  access,
  /actor\.is_admin/,
  "R2D1A-17 Admin can retain all-group compatibility",
);

assert.match(
  api,
  /authenticateWorkbenchActor/,
  "R2D1A-18 staff-me authenticates a server-side actor",
);

assert.match(
  api,
  /loadWorkbenchActorLineGroups/,
  "R2D1A-19 staff-me returns assigned LINE Groups",
);

assert.doesNotMatch(
  api,
  /access_key_hash/,
  "R2D1A-20 staff-me never returns credential hashes",
);

console.log(
  "PASS: R2D1A Staff Identity + Multi-Staff LINE Group Assignment Foundation",
);
