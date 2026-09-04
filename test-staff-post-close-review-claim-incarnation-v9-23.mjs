import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log(
  "===== Staff Post-close Review Claim Incarnation Hardening v9.23 =====",
);

const migrationDir =
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
  );

const migrationFiles =
  fs.readdirSync(migrationDir)
    .filter(
      name =>
        name.endsWith(
          "_harden_post_close_review_claim_incarnation.sql",
        ),
    );

assert.equal(
  migrationFiles.length,
  1,
  "expected exactly one post-close claim incarnation hardening migration",
);

const migrationPath =
  path.join(
    migrationDir,
    migrationFiles[0],
  );

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const existingClaimMigration =
  fs.readFileSync(
    path.join(
      migrationDir,
      "20260903133000_add_post_close_review_claim_lease.sql",
    ),
    "utf8",
  );

const previewHelper =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "lib",
      "staff-post-close-review-resolution.mjs",
    ),
    "utf8",
  );

function pass(id, message) {
  console.log(
    `PASS ${id}: ${message}`,
  );
}

assert.match(
  sql,
  /alter\s+table\s+public\.post_close_review_archive[\s\S]*post_close_claim_version/i,
);
assert.match(
  sql,
  /post_close_claim_version\s+bigint/i,
);
assert.match(
  sql,
  /default\s+0/i,
);
pass(
  "R2D3D3-01",
  "durable archive owns monotonic post-close claim version",
);

assert.match(
  sql,
  /post_close_claim_version[\s\S]{0,300}(?:>=|>)\s*-?1|post_close_claim_version[\s\S]{0,300}>=\s*0/i,
);
pass(
  "R2D3D3-02",
  "durable claim version cannot become negative",
);

assert.match(
  sql,
  /create\s+or\s+replace\s+function\s+public\.claim_staff_post_close_review_work/i,
);
pass(
  "R2D3D3-03",
  "claim RPC is replaced in hardening migration",
);

assert.match(
  sql,
  /staff-post-close-review-claim:/,
);
assert.match(
  sql,
  /pg_advisory_xact_lock/i,
);
pass(
  "R2D3D3-04",
  "existing archive-scoped advisory lock boundary is preserved",
);

assert.match(
  sql,
  /post_close_claim_version\s*=\s*post_close_claim_version\s*\+\s*1/i,
);
assert.match(
  sql,
  /returning[\s\S]{0,250}post_close_claim_version/i,
);
pass(
  "R2D3D3-05",
  "successful ownership transitions advance durable generation",
);

const hardcodedLeaseOne =
  /lease_version[\s\S]{0,200}(?:values\s*\([\s\S]{0,400},\s*1\s*,|=\s*1\b)/i;

assert.equal(
  hardcodedLeaseOne.test(sql),
  false,
  "new Claim must not recreate lease_version = 1",
);
pass(
  "R2D3D3-06",
  "new Claim cannot restart lease version at one",
);

assert.match(
  sql,
  /lease_version\s*=\s*v_[a-z0-9_]*(?:lease|claim)[a-z0-9_]*/i,
);
pass(
  "R2D3D3-07",
  "claim row receives durable archive generation",
);

const independentLeaseIncrement =
  /lease_version\s*=\s*lease_version\s*\+\s*1/i;

assert.equal(
  independentLeaseIncrement.test(sql),
  false,
  "claim row must not independently increment lease_version",
);
pass(
  "R2D3D3-08",
  "lease version is sourced from durable generation",
);

assert.match(
  existingClaimMigration,
  /delete\s+from\s+public\.staff_post_close_review_claims/i,
);

assert.equal(
  /post_close_claim_version\s*=\s*0/i.test(sql),
  false,
  "Release/hardening must never reset durable generation",
);
pass(
  "R2D3D3-09",
  "Release cannot reset durable claim generation",
);

assert.match(
  previewHelper,
  /archive_id/i,
);
assert.match(
  previewHelper,
  /staff_id/i,
);
assert.match(
  previewHelper,
  /lease_version/i,
);
assert.match(
  previewHelper,
  /fingerprint/i,
);
pass(
  "R2D3D3-10",
  "Preview token continues binding archive, Staff, lease and fingerprint",
);

for (const forbidden of [
  "order_items",
  "review_items",
  "messages",
  "resolve_review_with_preview",
  "ignore_review",
]) {
  assert.equal(
    sql.includes(forbidden),
    false,
    `hardening migration must not mutate live lifecycle: ${forbidden}`,
  );
}
pass(
  "R2D3D3-11",
  "hardening remains isolated from canonical/live Review lifecycle",
);

assert.match(
  sql,
  /security\s+definer/i,
);
assert.match(
  sql,
  /service_role/i,
);
pass(
  "R2D3D3-12",
  "claim RPC remains server-side security-definer boundary",
);

console.log(
  "PASS: Staff Post-close Review Claim Incarnation Hardening v9.23",
);
