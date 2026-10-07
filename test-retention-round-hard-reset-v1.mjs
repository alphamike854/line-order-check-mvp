"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20261007140500_retention_round_hard_reset_cutover.sql",
  "utf8",
);

const settlement = fs.readFileSync(
  "netlify/functions/settlement.mjs",
  "utf8",
);

function pos(value) {
  const n = migration.indexOf(value);
  assert.ok(n >= 0, `missing: ${value}`);
  return n;
}

assert.match(
  migration,
  /drop constraint if exists\s+settlement_round_storage_cleanup_queue_round_id_fkey/i,
);
assert.match(
  migration,
  /add column if not exists summary_group_id text/i,
);
console.log("PASS R3-01: Storage cleanup jobs outlive Round deletion");

for (const trigger of [
  "review_resolution_parser_corpus_before_delete_trg",
  "unsend_parser_corpus_before_delete_trg",
  "messages_parser_corpus_before_delete_trg",
]) {
  assert.match(
    migration,
    new RegExp(`drop trigger if exists\\s+${trigger}`, "i"),
  );
}
assert.match(
  migration,
  /revoke execute on function public\.archive_parser_corpus_message\(uuid\)\s+from service_role/i,
);
assert.match(
  migration,
  /revoke insert on public\.parser_corpus_archive\s+from service_role/i,
);
console.log("PASS R3-02: durable parser corpus capture stops before cutover");

assert.match(
  migration,
  /drop trigger if exists\s+messages_post_close_review_archive_before_delete_trg/i,
);
assert.match(
  migration,
  /drop trigger if exists\s+settlement_round_cleanup_preserve_post_close_review_trg/i,
);
console.log("PASS R3-03: post-close archive becomes current-Round-only");

assert.match(
  migration,
  /processed_at is null/i,
);
assert.match(
  migration,
  /parse_status = 'PENDING'/i,
);
assert.match(
  migration,
  /RETENTION_ROUND_IN_FLIGHT_BLOCKS_NEW_ROUND/,
);
console.log("PASS R3-04: webhook + image-media in-flight work fails closed");

assert.match(
  migration,
  /line_message_mirror_queue[\s\S]*q\.status\s+not\s+in\s*\(\s*'SENT'\s*,\s*'CANCELLED'\s*\)/i,
);
assert.match(
  migration,
  /MIRROR_DELIVERY_UNRESOLVED_BLOCKS_NEW_ROUND/,
);
assert.match(
  migration,
  /line_message_mirror_batch_current_round_send_trg/,
);
assert.match(
  migration,
  /MIRROR_ROUND_RETIRED/,
);
console.log("PASS R3-05: Mirror is guarded at both OPEN and SENDING boundaries");

assert.match(
  migration,
  /summary_group_round_runtime_state/,
);
assert.match(
  migration,
  /RETENTION_CURSOR_NOT_ON_SUCCESSOR/,
);
console.log("PASS R3-06: runtime cursor is cross-session retention authority");

const successor = pos("insert into public.settlement_summary_group_rounds (");
const purgeCall = migration.lastIndexOf(
  "public.purge_retired_summary_group_round(",
);
assert.ok(purgeCall > successor);
console.log("PASS R3-07: successor is inserted before retiring-Round purge");

for (const target of [
  "message_verification_revision_events",
  "parser_corpus_archive",
  "post_close_review_archive",
  "review_resolution_events",
  "unsend_events",
  "messages",
  "webhook_events",
]) {
  assert.match(
    migration,
    new RegExp(`delete from public\\.${target}`, "i"),
  );
}
console.log("PASS R3-08: explicit no-FK/archive/message transport state is purged");

assert.match(
  migration,
  /'review-images'/,
);
assert.match(
  migration,
  /'mirror-images'/,
);
assert.match(
  migration,
  /storage_cleanup_jobs/,
);
console.log("PASS R3-09: Review and Mirror Storage are queued durably");

const roundDelete = migration.lastIndexOf(
  "delete from public.settlement_summary_group_rounds",
);
const webhookDelete = migration.lastIndexOf(
  "delete from public.webhook_events",
);
assert.ok(roundDelete > webhookDelete);
console.log("PASS R3-10: retiring Round row is deleted last");

assert.match(
  migration,
  /rename to set_settlement_summary_group_accepting_pre_retention_v1/i,
);
assert.match(
  migration,
  /p_accepting_orders is false[\s\S]*set_settlement_summary_group_accepting_pre_retention_v1/i,
);
console.log("PASS R3-11: proven CLOSE implementation is retained behind private wrapper");

assert.match(
  migration,
  /max\(r\.round_no\)[\s\S]*settlement_session_id = p_settlement_session_id/i,
);
assert.doesNotMatch(
  migration,
  /max\(r\.daily_round_no\)/i,
);
console.log("PASS R3-12: internal round_no remains session-scoped; daily trigger remains authoritative");

assert.match(
  settlement,
  /storage_cleanup_jobs/,
);
assert.match(
  settlement,
  /new Map\(\)/,
);
assert.match(
  settlement,
  /\.from\(bucket\)[\s\S]*\.remove\(cleanupPaths\)/,
);
assert.match(
  settlement,
  /status: "FAILED"/,
);
assert.match(
  settlement,
  /settlement_round_storage_cleanup_queue[\s\S]*\.delete\(\)/,
);
console.log("PASS R3-13: API performs multi-bucket cleanup and deletes jobs only after Storage success");

assert.match(
  migration,
  /image_storage_bucket'[\s\S]*'review-images'/,
);
assert.match(
  migration,
  /image_storage_paths'[\s\S]*v_review_paths/,
);
console.log("PASS R3-14: legacy Storage response fields remain compatible");

assert.doesNotMatch(
  migration,
  /delete from public\.summary_groups/i,
);
assert.doesNotMatch(
  migration,
  /delete from public\.settlement_line_group_config/i,
);
assert.doesNotMatch(
  migration,
  /delete from public\.settlement_allocation_rules/i,
);
console.log("PASS R3-15: permanent Summary Group/mapping/allocation config is preserved");

console.log("PASS: Retention R3 Current-Round Hard Reset Cutover");
