import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/"
      + "20260927210000_add_staff_verification_timeline_read_model.sql",
    "utf8",
  );

const workbench =
  fs.readFileSync(
    "src/lib/staff-workbench.mjs",
    "utf8",
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

assert.match(
  migration,
  /create or replace function[\s\S]*public\.staff_workbench_verification_timeline/i,
);

assert.match(
  migration,
  /from public\.messages m/i,
);

assert.match(
  migration,
  /left join public\.message_verifications verification/i,
);

assert.match(
  migration,
  /verification_mode[\s\S]*CORRECTED/i,
);

assert.match(
  migration,
  /review_resolution_type[\s\S]*IGNORED/i,
);

assert.match(
  migration,
  /post_close_resolution_type/i,
);

assert.match(
  migration,
  /when source_rows\.unsent = true[\s\S]*'UNSENT'/i,
);

for (const status of [
  "PENDING",
  "HUMAN_VERIFIED",
  "HUMAN_CORRECTED",
  "HUMAN_IGNORED",
  "UNSENT",
]) {
  assert.match(
    migration,
    new RegExp(status),
    `missing status ${status}`,
  );

  assert.match(
    app,
    new RegExp(
      `data-verification-filter="${status}"`,
    ),
    `missing UI filter ${status}`,
  );
}

assert.doesNotMatch(
  migration,
  /insert\s+into\s+public\./i,
);

assert.doesNotMatch(
  migration,
  /update\s+public\./i,
);

assert.doesNotMatch(
  migration,
  /delete\s+from\s+public\./i,
);

assert.equal(
  (
    workbench.match(
      /"staff_workbench_verification_timeline"/g,
    )
    ?? []
  ).length,
  1,
  "RECENT Timeline must use exactly one broad Timeline RPC",
);

assert.equal(
  (
    workbench.match(
      /"staff_workbench_pending_verifications"/g,
    )
    ?? []
  ).length,
  2,
  "PRIORITY + HIGH_TOTAL must remain pending-only",
);

assert.match(
  app,
  /STAFF_VERIFICATION_STATUS_FILTERS/,
);

assert.match(
  app,
  /staffVerificationTimelineStatus[\s\S]*verification_status/,
);

assert.match(
  app,
  /staffVerificationCanMutate[\s\S]*staffVerificationTimelineStatus[\s\S]*=== "PENDING"/,
);

assert.match(
  app,
  /staffVerificationResolutionHtml[\s\S]*staffVerificationTimelineStatus[\s\S]*!== "PENDING"/,
);

assert.match(
  app,
  /activeStatusFilters[\s\S]*includes[\s\S]*staffVerificationTimelineStatus/,
);

for (const existing of [
  "NEEDS_FIX",
  "HIGH_TOTAL",
  "AUTO",
  "TEXT",
  "IMAGE",
]) {
  assert.match(
    app,
    new RegExp(
      `data-verification-filter="${existing}"`,
    ),
    `existing filter lost: ${existing}`,
  );
}

console.log(
  "PASS: Review completed visibility v1 contract",
);
