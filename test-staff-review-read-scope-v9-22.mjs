import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";


const source =
  await readFile(
    "netlify/functions/staff-reviews.mjs",
    "utf8",
  );


assert.match(
  source,
  /authenticateWorkbenchActor/,
  "R2D2B3A-01 Staff Review authenticates Workbench actor",
);

assert.match(
  source,
  /!auth\.actor\.staff_id/,
  "R2D2B3A-02 shared Dashboard identity cannot use Staff Review endpoint",
);

assert.match(
  source,
  /STAFF_IDENTITY_REQUIRED/,
  "R2D2B3A-03 Staff Review requires auditable Staff identity",
);

assert.match(
  source,
  /fetchOpenSettlementSession/,
  "R2D2B3A-04 Staff Review uses current settlement boundary",
);

assert.match(
  source,
  /loadActorSessionLineGroupIds/,
  "R2D2B3A-05 LINE Group scope is resolved server-side",
);

assert.match(
  source,
  /loadStaffWorkbenchReadModel/,
  "R2D2B3A-06 Review scope comes from authoritative Staff Workbench",
);

assert.match(
  source,
  /settlementSessionId:[\s\S]*?session\.id/,
  "R2D2B3A-07 Workbench query is bound to current settlement",
);

assert.match(
  source,
  /lineGroupIds/,
  "R2D2B3A-08 assigned LINE Groups are passed to Workbench scope",
);

assert.doesNotMatch(
  source,
  /fetchOpenReviews/,
  "R2D2B3A-09 Staff endpoint must not scan unrestricted Review collection",
);

assert.doesNotMatch(
  source,
  /requireDashboardAccess/,
  "R2D2B3A-10 Staff endpoint must not depend on Dashboard-only auth",
);

assert.match(
  source,
  /workItems[\s\S]*?messageRecordIds/,
  "R2D2B3A-11 evidence identities are derived only after Workbench scope",
);

assert.match(
  source,
  /\.from\(\s*"messages"\s*\)[\s\S]*?\.in\(\s*"id"[\s\S]*?ids/,
  "R2D2B3A-12 image path lookup is bounded to scoped message IDs",
);

assert.match(
  source,
  /createSignedUrl/,
  "R2D2B3A-13 private image evidence remains signed server-side",
);

assert.match(
  source,
  /image_storage_path:[\s\S]*?imageStoragePath/,
  "R2D2B3A-14 private evidence path exists only in server-side intermediate item",
);

assert.match(
  source,
  /const \{[\s\S]*?image_storage_path:[\s\S]*?storagePath,[\s\S]*?\.\.\.publicItem/,
  "R2D2B3A-15 private Storage path is stripped before response",
);

assert.match(
  source,
  /id:[\s\S]*?row\.review_id/,
  "R2D2B3A-16 Review API contract preserves review id",
);

assert.match(
  source,
  /text:[\s\S]*?row\.display_text/,
  "R2D2B3A-17 Review editor receives scoped Workbench display text",
);

assert.match(
  source,
  /parser_version:[\s\S]*?row\.parser_version/,
  "R2D2B3A-18 parser context remains available",
);

assert.match(
  source,
  /reason_codes:/,
  "R2D2B3A-19 Review reasons remain available",
);

assert.match(
  source,
  /warnings:/,
  "R2D2B3A-20 Review warnings remain available",
);


console.log(
  "PASS: R2D2B-3A Server-Scoped Staff Review Read",
);
