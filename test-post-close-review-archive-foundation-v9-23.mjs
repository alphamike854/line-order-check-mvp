"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/20260903080000_add_post_close_review_archive_foundation.sql",
    "utf8",
  );

const lifecycle =
  fs.readFileSync(
    "supabase/migrations/20260902043000_add_independent_summary_group_round_lifecycle.sql",
    "utf8",
  );

const settlementApi =
  fs.readFileSync(
    "netlify/functions/settlement.mjs",
    "utf8",
  );


const closeWithOpenReviews =
  fs.readFileSync(
    "supabase/migrations/20260826233000_allow_close_with_open_reviews.sql",
    "utf8",
  );

const roundOwnership =
  fs.readFileSync(
    "supabase/migrations/20260901170000_add_summary_group_round_ownership.sql",
    "utf8",
  );


console.log(
  "===== Durable Post-close Review Archive Foundation v9.23 =====",
);


// ------------------------------------------------------------
// R2D3A-01 — durable archive exists
// ------------------------------------------------------------

assert.match(
  migration,
  /create table if not exists[\s\S]*public\.post_close_review_archive/i,
);

assert.match(
  migration,
  /source_review_id bigint not null/,
);

assert.match(
  migration,
  /source_message_record_id uuid not null/,
);

console.log(
  "PASS R2D3A-01: durable Post-close Review archive exists",
);


// ------------------------------------------------------------
// R2D3A-02 — source operational identities must not be FKs
// ------------------------------------------------------------

const archiveTable =
  migration.match(
    /create table if not exists[\s\S]*?public\.post_close_review_archive[\s\S]*?\n  \);/,
  )?.[0] ?? "";

assert.ok(
  archiveTable,
  "archive table definition must be found",
);

assert.doesNotMatch(
  archiveTable,
  /source_review_id[\s\S]{0,100}references\s+public\.review_items/i,
);

assert.doesNotMatch(
  archiveTable,
  /source_message_record_id[\s\S]{0,100}references\s+public\.messages/i,
);

console.log(
  "PASS R2D3A-02: archive survives source Review/message purge",
);


// ------------------------------------------------------------
// R2D3A-03 — archive retains exact Round ownership
// ------------------------------------------------------------

assert.match(
  archiveTable,
  /round_id uuid not null[\s\S]*settlement_summary_group_rounds/,
);

assert.match(
  archiveTable,
  /settlement_session_id uuid not null/,
);

assert.match(
  archiveTable,
  /summary_group_id text not null/,
);

assert.match(
  archiveTable,
  /round_no integer not null/,
);

assert.match(
  archiveTable,
  /unique\s*\(\s*round_id,\s*source_review_id\s*\)/,
);

console.log(
  "PASS R2D3A-03: archive identity is Round-scoped and idempotent",
);


// ------------------------------------------------------------
// R2D3A-04 — human verification evidence is copied
// ------------------------------------------------------------

for (const field of [
  "raw_text",
  "normalized_text",
  "ocr_text",
  "parse_status",
  "parser_version",
  "reason_codes",
  "warnings",
  "image_storage_path",
  "source_review_status",
  "source_resolution_type",
]) {
  assert.match(
    archiveTable,
    new RegExp(`\\b${field}\\b`),
    `archive must retain ${field}`,
  );
}

console.log(
  "PASS R2D3A-04: archive retains human verification evidence",
);


// ------------------------------------------------------------
// R2D3A-05 — only actionable/deferred Review is archived
// ------------------------------------------------------------

const archiveFunction =
  migration.match(
    /create or replace function\s+public\.archive_post_close_review_message[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

assert.ok(
  archiveFunction,
  "archive helper must exist",
);

assert.match(
  archiveFunction,
  /v_round\.status <> 'CLOSED'/,
);

assert.match(
  archiveFunction,
  /review\.status = 'OPEN'[\s\S]*review\.resolution_type[\s\S]*'DEFERRED'/,
);

assert.match(
  archiveFunction,
  /on conflict\s*\(\s*round_id,\s*source_review_id\s*\)[\s\S]*do update/i,
);

console.log(
  "PASS R2D3A-05: archive is closed-Round scoped and retry-safe",
);


// ------------------------------------------------------------
// R2D3A-06 — message purge gets a final safety archive
// ------------------------------------------------------------

assert.match(
  migration,
  /before delete[\s\S]*on public\.messages[\s\S]*archive_post_close_review_before_message_delete/i,
);

assert.match(
  migration,
  /archive_post_close_review_message\([\s\S]*old\.id[\s\S]*v_target_round_id/,
);

console.log(
  "PASS R2D3A-06: message purge archives Review before cascade",
);


// ------------------------------------------------------------
// R2D3A-07 — image cleanup is suppressed for archived Review
// ------------------------------------------------------------

const cleanupProtection =
  migration.match(
    /create or replace function\s+public\.protect_post_close_review_storage_cleanup[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

assert.ok(
  cleanupProtection,
  "Storage cleanup protection function must exist",
);

assert.match(
  cleanupProtection,
  /post_close_review_archive/,
);

assert.match(
  cleanupProtection,
  /archive_post_close_review_message/,
);

assert.match(
  cleanupProtection,
  /return null/,
);

assert.match(
  migration,
  /before insert[\s\S]*on public\.settlement_round_storage_cleanup_queue[\s\S]*protect_post_close_review_storage_cleanup/i,
);

console.log(
  "PASS R2D3A-07: archived private image evidence bypasses Round cleanup",
);


// ------------------------------------------------------------
// R2D3A-08 — existing closed Review is backfilled
// ------------------------------------------------------------

assert.match(
  migration,
  /do \$\$[\s\S]*review\.status = 'OPEN'[\s\S]*review\.resolution_type[\s\S]*'DEFERRED'[\s\S]*archive_post_close_review_message/i,
);

console.log(
  "PASS R2D3A-08: already-closed pending Review is backfilled",
);


// ------------------------------------------------------------
// R2D3A-09 — pending cleanup rows are reconciled safely
// ------------------------------------------------------------

assert.match(
  migration,
  /delete from[\s\S]*settlement_round_storage_cleanup_queue[\s\S]*queue\.status = 'PENDING'[\s\S]*post_close_review_archive/i,
);

console.log(
  "PASS R2D3A-09: pending Storage cleanup is reconciled with archive",
);


// ------------------------------------------------------------
// R2D3A-10 — no new Review top-level status
// ------------------------------------------------------------

assert.doesNotMatch(
  migration,
  /alter table\s+public\.review_items[\s\S]*status/i,
);

assert.doesNotMatch(
  migration,
  /\bVERIFIED\b/,
);

console.log(
  "PASS R2D3A-10: existing Review status contract remains unchanged",
);


// ------------------------------------------------------------
// R2D3A-11 — no canonical accounting mutation
// ------------------------------------------------------------

assert.doesNotMatch(
  migration,
  /(insert into|update|delete from)\s+public\.order_items/i,
);

console.log(
  "PASS R2D3A-11: canonical order_items are untouched",
);


// ------------------------------------------------------------
// R2D3A-12 — R2D2 claim/resolve functions remain untouched
// ------------------------------------------------------------

for (const name of [
  "assert_staff_review_resolution_claim",
  "resolve_staff_review_with_preview",
  "ignore_staff_review",
  "claim_staff_review_work",
  "release_staff_review_work",
]) {
  assert.doesNotMatch(
    migration,
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}`,
      "i",
    ),
    `R2D3A must not replace ${name}`,
  );
}

console.log(
  "PASS R2D3A-12: R2D2 real-time Staff boundaries are untouched",
);


// ------------------------------------------------------------
// R2D3A-13 — lifecycle remains destructive operational reset
// ------------------------------------------------------------

assert.match(
  lifecycle,
  /delete from public\.messages/,
);

assert.match(
  lifecycle,
  /settlement_summary_group_round_snapshots/,
);

console.log(
  "PASS R2D3A-13: existing Round reset semantics remain intact",
);


// ------------------------------------------------------------
// R2D3A-14 — Storage deletion remains queue driven
// ------------------------------------------------------------

assert.match(
  settlementApi,
  /settlement_round_storage_cleanup_queue/,
);

assert.match(
  settlementApi,
  /\.from\(bucket\)[\s\S]*\.remove\(cleanupPaths\)/,
);

console.log(
  "PASS R2D3A-14: Storage cleanup API contract remains unchanged",
);



// ------------------------------------------------------------
// R2D3A-15 — SECURITY DEFINER trigger functions are private
// ------------------------------------------------------------

assert.match(
  migration,
  /revoke all[\s\S]*archive_post_close_review_before_message_delete\(\)[\s\S]*from public,\s*anon,\s*authenticated/i,
);

assert.match(
  migration,
  /revoke all[\s\S]*protect_post_close_review_storage_cleanup\(\)[\s\S]*from public,\s*anon,\s*authenticated/i,
);

console.log(
  "PASS R2D3A-15: SECURITY DEFINER trigger functions are private",
);


// ------------------------------------------------------------
// R2D3A-16 — durable archive has no direct delete grant
// ------------------------------------------------------------

const archiveGrant =
  migration.match(
    /grant[\s\S]*?on public\.post_close_review_archive[\s\S]*?to service_role;/i,
  )?.[0] ?? "";

assert.ok(
  archiveGrant,
  "archive service_role grant must exist",
);

assert.doesNotMatch(
  archiveGrant,
  /\bdelete\b/i,
);

assert.match(
  migration,
  /revoke\s+delete\s+on\s+public\.post_close_review_archive\s+from\s+service_role/i,
);

console.log(
  "PASS R2D3A-16: durable archive explicitly denies service_role DELETE",
);



// ------------------------------------------------------------
// R2D3A-17 — Round close archives Review immediately
// ------------------------------------------------------------

const roundCloseArchive =
  migration.match(
    /create or replace function\s+public\.archive_post_close_reviews_on_round_close[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

assert.ok(
  roundCloseArchive,
  "Round-close archive function must exist",
);

assert.match(
  roundCloseArchive,
  /new\.status <> 'CLOSED'/,
);

assert.match(
  roundCloseArchive,
  /review\.status = 'OPEN'[\s\S]*review\.resolution_type[\s\S]*'DEFERRED'/,
);

assert.match(
  roundCloseArchive,
  /archive_post_close_review_message/,
);

assert.match(
  migration,
  /after update of status[\s\S]*on public\.settlement_summary_group_rounds[\s\S]*new\.status = 'CLOSED'[\s\S]*archive_post_close_reviews_on_round_close/i,
);

console.log(
  "PASS R2D3A-17: Round CLOSED transition archives pending/deferred Review immediately",
);


// ------------------------------------------------------------
// R2D3A-18 — Round-close trigger function is private
// ------------------------------------------------------------

assert.match(
  migration,
  /revoke all[\s\S]*archive_post_close_reviews_on_round_close\(\)[\s\S]*from public,\s*anon,\s*authenticated/i,
);

console.log(
  "PASS R2D3A-18: Round-close archive trigger function is private",
);



// ------------------------------------------------------------
// R2D3A-19 — full settlement close defers Review before parent close
// ------------------------------------------------------------

const settlementCloseFunction =
  closeWithOpenReviews.match(
    /create or replace function\s+public\.close_settlement_session[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

assert.ok(
  settlementCloseFunction,
  "latest non-blocking settlement close function must exist",
);

const deferredPosition =
  settlementCloseFunction.indexOf(
    "resolution_type = 'DEFERRED'",
  );

const parentClosePosition =
  settlementCloseFunction.indexOf(
    "update public.settlement_sessions",
  );

assert.ok(
  deferredPosition >= 0,
  "settlement close must mark unresolved Review DEFERRED",
);

assert.ok(
  parentClosePosition > deferredPosition,
  "Review must become DEFERRED before parent settlement closes",
);

console.log(
  "PASS R2D3A-19: full settlement close defers Review before parent close",
);


// ------------------------------------------------------------
// R2D3A-20 — parent close still closes every OPEN Summary Group Round
// ------------------------------------------------------------

const parentRoundCloseFunction =
  roundOwnership.match(
    /create or replace function\s+public\.sync_closed_settlement_to_summary_group_rounds[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

assert.ok(
  parentRoundCloseFunction,
  "parent-close Round synchronization function must exist",
);

assert.match(
  parentRoundCloseFunction,
  /new\.status = 'CLOSED'/,
);

assert.match(
  parentRoundCloseFunction,
  /update[\s\S]*public\.settlement_summary_group_rounds/,
);

assert.match(
  parentRoundCloseFunction,
  /settlement_session_id\s*=\s*new\.id/,
);

assert.match(
  parentRoundCloseFunction,
  /status = 'OPEN'/,
);

assert.match(
  roundOwnership,
  /create trigger[\s\S]*settlement_sessions_round_close_sync_trg[\s\S]*on public\.settlement_sessions/i,
);

assert.doesNotMatch(
  lifecycle,
  /drop trigger if exists\s+settlement_sessions_round_close_sync_trg/i,
);

console.log(
  "PASS R2D3A-20: parent settlement close still closes OPEN Summary Group Rounds",
);


console.log(
  "PASS: Durable Post-close Review Archive Foundation v9.23",
);
