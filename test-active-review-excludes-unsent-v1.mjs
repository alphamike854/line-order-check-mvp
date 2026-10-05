import assert from "node:assert/strict";
import fs from "node:fs";

const dashboardApi =
  fs.readFileSync(
    "src/lib/dashboard-api.mjs",
    "utf8",
  );

const staffMigration =
  fs.readFileSync(
    "supabase/migrations/20260902072000_add_staff_workbench_read_model.sql",
    "utf8",
  );

const staffAccess =
  fs.readFileSync(
    "src/lib/staff-review-access.mjs",
    "utf8",
  );

function jsFunctionBlock(
  source,
  functionName,
) {
  const start =
    new RegExp(
      `export async function ${functionName}\\s*\\(`,
    ).exec(source);

  assert.ok(
    start,
    `missing ${functionName}`,
  );

  const rest =
    source.slice(
      start.index
      + start[0].length,
    );

  const next =
    /\nexport async function [A-Za-z0-9_$]+\s*\(/.exec(
      rest,
    );

  const end =
    next
      ? start.index
        + start[0].length
        + next.index
      : source.length;

  return source.slice(
    start.index,
    end,
  );
}

function sqlFunctionBlock(
  source,
  functionName,
) {
  const start =
    new RegExp(
      `create or replace function public\\.${functionName}\\s*\\(`,
      "i",
    ).exec(source);

  assert.ok(
    start,
    `missing SQL function ${functionName}`,
  );

  const rest =
    source.slice(
      start.index,
    );

  const end =
    rest.indexOf(
      "\n$$;",
    );

  assert.ok(
    end >= 0,
    `unterminated SQL function ${functionName}`,
  );

  return rest.slice(
    0,
    end + 4,
  );
}

console.log(
  "===== Active Review Excludes Unsent v1 =====",
);


// ------------------------------------------------------------
// ARU-01 Admin Review remains Current-Round scoped.
// ------------------------------------------------------------

const adminReviews =
  jsFunctionBlock(
    dashboardApi,
    "fetchOpenReviews",
  );

assert.match(
  adminReviews,
  /\.in\(\s*"summary_group_round_id"\s*,\s*normalizedRoundIds/,
);

console.log(
  "PASS ARU-01: Admin Active Review remains Current-Round scoped",
);


// ------------------------------------------------------------
// ARU-02 Admin list rejects unsent messages at DB read.
// ------------------------------------------------------------

assert.match(
  adminReviews,
  /\.eq\(\s*"unsent"\s*,\s*false\s*,?\s*\)/,
);

console.log(
  "PASS ARU-02: Admin Active Review excludes unsent messages",
);


// ------------------------------------------------------------
// ARU-03 Filter occurs before Review IDs are constructed.
// ------------------------------------------------------------

const unsentFilterIndex =
  adminReviews.search(
    /\.eq\(\s*"unsent"\s*,\s*false/,
  );

const messageMapIndex =
  adminReviews.indexOf(
    "const messageById",
  );

assert.ok(
  unsentFilterIndex >= 0
  && messageMapIndex > unsentFilterIndex,
);

console.log(
  "PASS ARU-03: unsent messages are excluded before Review join",
);


// ------------------------------------------------------------
// ARU-04 Emergency count suppression remains unchanged.
// ------------------------------------------------------------

const reviewCount =
  jsFunctionBlock(
    dashboardApi,
    "fetchOpenReviewCount",
  );

assert.match(
  reviewCount,
  /EMERGENCY AVAILABILITY MODE/,
);

assert.match(
  reviewCount,
  /return 0;/,
);

console.log(
  "PASS ARU-04: emergency Review count suppression unchanged",
);


// ------------------------------------------------------------
// ARU-05 Staff summary already excludes unsent Review.
// ------------------------------------------------------------

const staffSummary =
  sqlFunctionBlock(
    staffMigration,
    "staff_workbench_summary",
  );

assert.match(
  staffSummary,
  /review\.status\s*=\s*'OPEN'[\s\S]*?m\.unsent\s*=\s*false/i,
);

console.log(
  "PASS ARU-05: Staff Review count already excludes unsent messages",
);


// ------------------------------------------------------------
// ARU-06 Staff Review feed already excludes unsent Review.
// ------------------------------------------------------------

const staffOpenReviews =
  sqlFunctionBlock(
    staffMigration,
    "staff_workbench_open_reviews",
  );

assert.match(
  staffOpenReviews,
  /review\.status\s*=\s*'OPEN'[\s\S]*?m\.unsent\s*=\s*false/i,
);

console.log(
  "PASS ARU-06: Staff Active Review feed already excludes unsent messages",
);


// ------------------------------------------------------------
// ARU-07 Staff direct access still fails closed on unsent.
// ------------------------------------------------------------

assert.match(
  staffAccess,
  /if\s*\(\s*message\.unsent\s*\)/,
);

assert.match(
  staffAccess,
  /MESSAGE_ALREADY_UNSENT/,
);

console.log(
  "PASS ARU-07: Staff direct Review access remains fail-closed for unsent",
);


// ------------------------------------------------------------
// ARU-08 No DB lifecycle mutation added in this phase.
// ------------------------------------------------------------

assert.doesNotMatch(
  adminReviews,
  /\.(update|insert|delete|upsert)\s*\(/,
);

console.log(
  "PASS ARU-08: patch remains read-model only",
);

console.log(
  "PASS: Active Review Excludes Unsent v1",
);
