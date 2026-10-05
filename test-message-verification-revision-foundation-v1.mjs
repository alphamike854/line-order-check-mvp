import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/"
  + "20261005090000_add_message_verification_revision_foundation.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

console.log(
  "===== Human Verification Revision Foundation B1 =====",
);


// B1-01 — current authoritative row remains one-to-one,
// now protected by optimistic revision fencing.
assert.match(
  sql,
  /alter table\s+public\.message_verifications[\s\S]*revision_no bigint not null[\s\S]*default 1/i,
);

assert.match(
  sql,
  /message_verifications_revision_no_check[\s\S]*revision_no >= 1/i,
);

console.log(
  "PASS B1-01: current Human Truth receives monotonic revision_no",
);


// B1-02 — latest revision actor/time is explicit without
// rewriting original verified_at / verified_by_* history.
for (const column of [
  "last_revised_at",
  "last_revised_by_staff_id",
  "last_revised_by_staff_code",
  "last_revised_by_display_name",
]) {
  assert.match(
    sql,
    new RegExp(
      String.raw`add column if not exists[\s\S]*${column}`,
      "i",
    ),
  );
}

console.log(
  "PASS B1-02: latest revision metadata is explicit",
);


// B1-03 — append-only durable audit table.
assert.match(
  sql,
  /create table if not exists\s+public\.message_verification_revision_events/i,
);

assert.match(
  sql,
  /previous_snapshot jsonb not null/i,
);

assert.match(
  sql,
  /next_snapshot jsonb not null/i,
);

assert.match(
  sql,
  /unique\s*\(\s*message_record_id,\s*to_revision_no\s*\)/i,
);

assert.match(
  sql,
  /to_revision_no\s*=\s*from_revision_no \+ 1/i,
);

console.log(
  "PASS B1-03: append-only revision audit contract exists",
);


// B1-04 — revision claim is a distinct path and requires
// existing Human Truth.
assert.match(
  sql,
  /create or replace function\s+public\.claim_staff_message_verification_revision_work/i,
);

assert.match(
  sql,
  /from public\.message_verifications mv[\s\S]*MESSAGE_NOT_VERIFIED/i,
);

assert.match(
  sql,
  /'staff-work-claim:'[\s\S]*p_message_record_id::text/i,
);

assert.match(
  sql,
  /public\.staff_message_work_claims/i,
);

console.log(
  "PASS B1-04: revision claim is separate and reuses lease fencing",
);


// B1-05 — B1 deliberately fails closed outside latest OPEN Round.
assert.match(
  sql,
  /order by[\s\S]*r\.round_no desc[\s\S]*limit 1/i,
);

assert.match(
  sql,
  /MESSAGE_ROUND_NOT_CURRENT/,
);

assert.match(
  sql,
  /REVISION_OPEN_ROUND_ONLY/,
);

console.log(
  "PASS B1-05: revision is latest-OPEN-Round only",
);


// B1-06 — apply RPC carries both optimistic revision
// and lease fencing.
assert.match(
  sql,
  /create or replace function\s+public\.revise_staff_message_verification_order/i,
);

assert.match(
  sql,
  /p_expected_lease_version bigint/i,
);

assert.match(
  sql,
  /p_expected_revision_no bigint/i,
);

assert.match(
  sql,
  /STALE_CLAIM_VERSION/,
);

assert.match(
  sql,
  /STALE_VERIFICATION_REVISION/,
);

console.log(
  "PASS B1-06: revision apply has dual concurrency fencing",
);


// B1-07 — parser/source proposal remains immutable evidence.
assert.match(
  sql,
  /source_parser_version\s*=\s*coalesce\(\s*source_parser_version,\s*v_verification\.verified_parser_version/i,
);

assert.match(
  sql,
  /source_normalized_text\s*=\s*coalesce\(\s*source_normalized_text,\s*v_verification\.verified_normalized_text/i,
);

assert.match(
  sql,
  /source_order_items\s*=\s*coalesce\(\s*source_order_items,\s*v_verification\.verified_order_items/i,
);

console.log(
  "PASS B1-07: original parser proposal is preserved",
);


// B1-08 — canonical OPEN-Round mutation and Human Truth
// mutation occur inside the same RPC transaction.
assert.match(
  sql,
  /delete from\s+public\.order_items[\s\S]*message_record_id\s*=\s*p_message_record_id/i,
);

assert.match(
  sql,
  /insert into\s+public\.order_items/i,
);

assert.match(
  sql,
  /update public\.messages[\s\S]*normalized_text\s*=\s*p_corrected_normalized_text/i,
);

assert.match(
  sql,
  /update public\.message_verifications[\s\S]*revision_no\s*=\s*revision_no \+ 1/i,
);

console.log(
  "PASS B1-08: canonical rows + current Human Truth revise atomically",
);


// B1-09 — each successful revision writes before/after audit.
assert.match(
  sql,
  /v_before\s*:=\s*to_jsonb\(v_verification\)/i,
);

assert.match(
  sql,
  /v_after\s*:=\s*to_jsonb\(v_verification\)/i,
);

assert.match(
  sql,
  /insert into\s+public\.message_verification_revision_events/i,
);

console.log(
  "PASS B1-09: every successful revision appends before/after audit",
);


// B1-10 — revision apply releases only the exact lease.
assert.match(
  sql,
  /delete from\s+public\.staff_message_work_claims[\s\S]*staff_id\s*=\s*p_staff_id[\s\S]*lease_version\s*=\s*p_expected_lease_version/i,
);

assert.match(
  sql,
  /CLAIM_RELEASE_FAILED/,
);

console.log(
  "PASS B1-10: revision releases only exact owned lease",
);


// B1-11 — existing first-pass RPCs are NOT replaced here.
assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.claim_staff_message_verification_work\s*\(/i,
);

assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.verify_staff_message_order\s*\(/i,
);

assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.correct_staff_message_verification_order\s*\(/i,
);

console.log(
  "PASS B1-11: original verification RPC semantics remain untouched",
);


// B1-12 — privilege boundary.
assert.match(
  sql,
  /revoke all[\s\S]*claim_staff_message_verification_revision_work[\s\S]*from public,\s*anon,\s*authenticated/i,
);

assert.match(
  sql,
  /grant execute[\s\S]*claim_staff_message_verification_revision_work[\s\S]*to service_role/i,
);

assert.match(
  sql,
  /revoke all[\s\S]*revise_staff_message_verification_order[\s\S]*from public,\s*anon,\s*authenticated/i,
);

assert.match(
  sql,
  /grant execute[\s\S]*revise_staff_message_verification_order[\s\S]*to service_role/i,
);

console.log(
  "PASS B1-12: revision RPCs remain service-role only",
);



// B1-13 — revision canonical write must preserve settlement
// attribution and delegate immutable Round ownership to the
// existing order_items trigger, exactly like current correction.
const revisionFunctionMatch =
  sql.match(
    /create or replace function\s+public\.revise_staff_message_verification_order[\s\S]*?\n\$\$;/i,
  );

assert.ok(
  revisionFunctionMatch,
  "revision function must exist",
);

const revisionSql =
  revisionFunctionMatch[0];

const orderInsertMatch =
  revisionSql.match(
    /insert into\s+public\.order_items\s*\([\s\S]*?from jsonb_array_elements\([\s\S]*?\)\s*item;/i,
  );

assert.ok(
  orderInsertMatch,
  "revision order_items insert must exist",
);

const orderInsertSql =
  orderInsertMatch[0];

assert.match(
  orderInsertSql,
  /settlement_session_id/i,
);

assert.doesNotMatch(
  orderInsertSql,
  /summary_group_round_id/i,
);

assert.match(
  revisionSql,
  /order_items_round_ownership_trg inherits and validates/i,
);

console.log(
  "PASS B1-13: canonical order rows preserve session and inherit Round ownership",
);


// B1-14 — Human Truth must be bound to the exact canonical
// database snapshot, not merely the submitted payload.
assert.match(
  revisionSql,
  /jsonb_agg\([\s\S]*oi\.category[\s\S]*oi\.code[\s\S]*oi\.quantity/i,
);

assert.match(
  revisionSql,
  /into\s+v_corrected_order_items/i,
);

assert.match(
  revisionSql,
  /CORRECTED_CANONICAL_SNAPSHOT_MISMATCH/,
);

assert.match(
  revisionSql,
  /verified_order_items\s*=\s*v_corrected_order_items/i,
);

console.log(
  "PASS B1-14: revised Human Truth is exact canonical snapshot",
);


// B1-15 — audit table is append-only from the application role.
// service_role receives SELECT only; audit writes occur through
// the SECURITY DEFINER revision RPC.
assert.match(
  sql,
  /revoke all[\s\S]*on table[\s\S]*public\.message_verification_revision_events[\s\S]*from public,\s*anon,\s*authenticated,\s*service_role/i,
);

assert.match(
  sql,
  /grant select[\s\S]*on table[\s\S]*public\.message_verification_revision_events[\s\S]*to service_role/i,
);

console.log(
  "PASS B1-15: revision audit direct DML is blocked",
);


console.log(
  "PASS: Human Verification Revision Foundation B1",
);
