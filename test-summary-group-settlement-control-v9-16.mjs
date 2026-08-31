"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/20260831020000_add_summary_group_settlement_controls.sql",
    "utf8",
  );

const webhook =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const settlementApi =
  fs.readFileSync(
    "netlify/functions/settlement.mjs",
    "utf8",
  );


// S1-01: one global settlement model remains intact.
assert.doesNotMatch(
  migration,
  /alter table\s+public\.settlement_sessions[\s\S]*summary_group_id/i,
);

assert.doesNotMatch(
  migration,
  /drop index[\s\S]*settlement_sessions_one_open_uidx/i,
);

console.log(
  "PASS S1-01 global settlement model remains unchanged",
);


// S1-02: missing override means OPEN.
assert.match(
  migration,
  /is_settlement_summary_group_accepting/,
);

assert.match(
  migration,
  /coalesce\([\s\S]*true[\s\S]*\)/,
);

console.log(
  "PASS S1-02 Summary Group defaults to accepting orders",
);


// S1-03: group state changes are audited.
assert.match(
  migration,
  /settlement_summary_group_control_events/,
);

assert.match(
  migration,
  /previous_accepting_orders/,
);

assert.match(
  migration,
  /new_accepting_orders/,
);

console.log(
  "PASS S1-03 Summary Group state changes are audited",
);


// S1-04: group state can change only while settlement is OPEN.
assert.match(
  migration,
  /v_session\.status\s*<>\s*'OPEN'/,
);

assert.match(
  migration,
  /SETTLEMENT_NOT_OPEN/,
);

console.log(
  "PASS S1-04 closed settlement cannot change group accepting state",
);


// S1-05: canonical order insert has DB protection.
assert.match(
  migration,
  /enforce_order_item_summary_group_accepting/,
);

assert.match(
  migration,
  /SUMMARY_GROUP_CLOSED/,
);

assert.match(
  migration,
  /before insert[\s\S]*order_items/i,
);

console.log(
  "PASS S1-05 database blocks canonical inserts into closed group",
);


// S1-06: webhook checks group before text parser.
const textHandler =
  webhook.match(
    /async function handleTextMessage[\s\S]*?async function storeImageReviewEvidence/,
  )?.[0] ?? "";

assert.ok(
  textHandler,
  "text handler must exist",
);

const textGate =
  textHandler.indexOf(
    "isSettlementSummaryGroupAccepting",
  );

const textParser =
  textHandler.indexOf(
    "parseOrder(",
  );

assert.ok(
  textGate >= 0
  && textParser > textGate,
  "text group gate must run before parser",
);

console.log(
  "PASS S1-06 closed text group stops before parser",
);


// S1-07: image group gate runs before OCR/provider work.
const imageHandler =
  webhook.match(
    /async function handleImageMessage[\s\S]*?async function handleUnsend/,
  )?.[0] ?? "";

assert.ok(
  imageHandler,
  "image handler must exist",
);

const imageGate =
  imageHandler.indexOf(
    "isSettlementSummaryGroupAccepting",
  );

const imageProvider =
  imageHandler.indexOf(
    "contentProvider",
  );

assert.ok(
  imageGate >= 0
  && imageProvider > imageGate,
  "image group gate must run before OCR/provider handling",
);

console.log(
  "PASS S1-07 closed image group stops before OCR",
);


// S1-08: closed group creates audited Review.
assert.match(
  webhook,
  /SUMMARY_GROUP_CLOSED/,
);

assert.match(
  webhook,
  /markSummaryGroupClosedReview/,
);

console.log(
  "PASS S1-08 closed-group messages enter Review",
);


// S1-09: settlement API exposes states.
assert.match(
  settlementApi,
  /summary_group_states/,
);

assert.match(
  settlementApi,
  /settlement_summary_group_controls/,
);

console.log(
  "PASS S1-09 settlement API exposes Summary Group states",
);


// S1-10: API supports per-group open/close.
assert.match(
  settlementApi,
  /action === "OPEN_GROUP"/,
);

assert.match(
  settlementApi,
  /action === "CLOSE_GROUP"/,
);

assert.match(
  settlementApi,
  /set_settlement_summary_group_accepting/,
);

console.log(
  "PASS S1-10 settlement API supports group open and close",
);

// S1-11: canonical persistence and group close
// must serialize on the same advisory-lock namespace.
const hardeningMigration =
  fs.readFileSync(
    "supabase/migrations/20260831021000_harden_summary_group_settlement_boundary.sql",
    "utf8",
  );

const lockNamespace =
  "SETTLEMENT_SUMMARY_GROUP_CONTROL";

assert.match(
  migration,
  new RegExp(lockNamespace),
);

assert.match(
  hardeningMigration,
  new RegExp(lockNamespace),
);

assert.match(
  hardeningMigration,
  /pg_advisory_xact_lock/,
);

assert.match(
  hardeningMigration,
  /is_settlement_summary_group_accepting/,
);

assert.match(
  hardeningMigration,
  /SUMMARY_GROUP_CLOSED/,
);

console.log(
  "PASS S1-11 group close and canonical persistence share advisory lock",
);

console.log(
  "PASS: Summary Group settlement control S1 v9.16",
);
