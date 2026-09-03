import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";


const api =
  await readFile(
    "netlify/functions/staff-post-close-reviews.mjs",
    "utf8",
  );

const helper =
  await readFile(
    "src/lib/staff-post-close-review.mjs",
    "utf8",
  );

const archiveMigration =
  await readFile(
    "supabase/migrations/20260903080000_add_post_close_review_archive_foundation.sql",
    "utf8",
  );


console.log(
  "===== Staff Post-close Review Read v9.23 =====",
);


// ------------------------------------------------------------
// R2D3B1-01 — separate Staff-only endpoint
// ------------------------------------------------------------

assert.match(
  api,
  /authenticateWorkbenchActor/,
);

assert.match(
  api,
  /!auth\.actor\.staff_id/,
);

assert.match(
  api,
  /STAFF_IDENTITY_REQUIRED/,
);

assert.match(
  api,
  /\/api\/staff-post-close-reviews/,
);

console.log(
  "PASS R2D3B1-01: post-close Review has a separate Staff-only endpoint",
);


// ------------------------------------------------------------
// R2D3B1-02 — authorization comes from current Staff assignments
// ------------------------------------------------------------

assert.match(
  api,
  /loadWorkbenchActorLineGroups/,
);

assert.match(
  api,
  /lineGroupIds/,
);

assert.match(
  helper,
  /\.in\(\s*"line_group_id",[\s\S]*safeLineGroupIds/,
);

console.log(
  "PASS R2D3B1-02: current Staff LINE Group assignments scope archive access",
);


// ------------------------------------------------------------
// R2D3B1-03 — historical lifecycle is NOT current-settlement scoped
// ------------------------------------------------------------

assert.doesNotMatch(
  api,
  /fetchOpenSettlementSession/,
);

assert.doesNotMatch(
  api,
  /loadActorSessionLineGroupIds/,
);

assert.doesNotMatch(
  api,
  /loadStaffWorkbenchReadModel/,
);

assert.doesNotMatch(
  helper,
  /settlement_line_group_config/,
);

console.log(
  "PASS R2D3B1-03: post-close queue is independent of current settlement Workbench",
);


// ------------------------------------------------------------
// R2D3B1-04 — durable archive is authoritative source
// ------------------------------------------------------------

assert.match(
  helper,
  /\.from\(\s*"post_close_review_archive",?\s*\)/,
);

assert.match(
  helper,
  /summary_group_id/,
);

assert.match(
  helper,
  /\.eq\(\s*"summary_group_id",[\s\S]*safeSummaryGroupId/,
);

assert.match(
  archiveMigration,
  /source_review_id bigint not null/,
);

assert.match(
  archiveMigration,
  /source_message_record_id uuid not null/,
);

console.log(
  "PASS R2D3B1-04: durable archive owns historical Review identity and scope",
);


// ------------------------------------------------------------
// R2D3B1-05 — no volatile operational source dependency
// ------------------------------------------------------------

for (const source of [
  api,
  helper,
]) {
  assert.doesNotMatch(
    source,
    /\.from\(\s*"review_items"\s*\)/,
  );

  assert.doesNotMatch(
    source,
    /\.from\(\s*"messages"\s*\)/,
  );

  assert.doesNotMatch(
    source,
    /staff_message_work_claims/,
  );

  assert.doesNotMatch(
    source,
    /staff_workbench_claim_state/,
  );
}

console.log(
  "PASS R2D3B1-05: post-close read survives operational Review/message purge",
);


// ------------------------------------------------------------
// R2D3B1-06 — read is bounded and deterministic
// ------------------------------------------------------------

assert.match(
  helper,
  /\.range\(/,
);

assert.match(
  helper,
  /\.order\(\s*"business_date"/,
);

assert.match(
  helper,
  /\.order\(\s*"source_review_id"/,
);

assert.match(
  helper,
  /\.order\(\s*"id"/,
);

assert.match(
  helper,
  /count:\s*"exact"/,
);

console.log(
  "PASS R2D3B1-06: post-close queue has bounded deterministic pagination",
);


// ------------------------------------------------------------
// R2D3B1-07 — archive identity remains distinct from source Review id
// ------------------------------------------------------------

assert.match(
  helper,
  /archive_id:[\s\S]*row\?\.id/,
);

assert.match(
  helper,
  /source_review_id:[\s\S]*row\?\.source_review_id/,
);

console.log(
  "PASS R2D3B1-07: durable archive identity is not confused with purged Review identity",
);


// ------------------------------------------------------------
// R2D3B1-08 — private Storage path never leaves read endpoint
// ------------------------------------------------------------

const itemBuilderStart =
  helper.indexOf(
    "export function buildStaffPostCloseReviewItem(",
  );

assert.ok(
  itemBuilderStart >= 0,
  "public post-close Review item builder must exist",
);

const itemBuilder =
  helper.slice(
    itemBuilderStart,
  );

assert.match(
  itemBuilder,
  /image_storage_path:[\s\S]*imageStoragePath/,
);

assert.match(
  itemBuilder,
  /has_image_evidence:/,
);

const publicReturnStart =
  itemBuilder.indexOf(
    "return {",
  );

assert.ok(
  publicReturnStart >= 0,
  "public post-close Review item return object must exist",
);

const publicReturn =
  itemBuilder.slice(
    publicReturnStart,
  );

assert.doesNotMatch(
  publicReturn,
  /\bimage_storage_path\s*:/,
);

assert.doesNotMatch(
  api,
  /createSignedUrl/,
);

console.log(
  "PASS R2D3B1-08: image evidence is presence-only until dedicated preview phase",
);


// ------------------------------------------------------------
// R2D3B1-09 — phase remains strictly read-only
// ------------------------------------------------------------

for (const source of [
  api,
  helper,
]) {
  assert.doesNotMatch(
    source,
    /\.insert\(/,
  );

  assert.doesNotMatch(
    source,
    /\.update\(/,
  );

  assert.doesNotMatch(
    source,
    /\.delete\(/,
  );

  assert.doesNotMatch(
    source,
    /\.rpc\(/,
  );
}

console.log(
  "PASS R2D3B1-09: post-close Review phase is read-only",
);


console.log(
  "PASS: Staff Post-close Review Read v9.23",
);
