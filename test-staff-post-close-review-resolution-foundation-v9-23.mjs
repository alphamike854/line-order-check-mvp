import assert from "node:assert/strict";

import {
  existsSync,
  readFileSync,
} from "node:fs";


const migrationPath =
  "supabase/migrations/20260904090000_add_post_close_review_resolution_foundation.sql";


console.log(
  "===== Staff Post-close Review Resolution Foundation v9.23 =====",
);


// ============================================================
// D1A-01 — migration exists.
// ============================================================

assert.equal(
  existsSync(
    migrationPath,
  ),
  true,
  `missing migration ${migrationPath}`,
);

const migration =
  readFileSync(
    migrationPath,
    "utf8",
  );


function sqlFunctionBlock(
  functionName,
) {
  const pattern =
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`,
      "i",
    );

  const match =
    pattern.exec(
      migration,
    );

  assert.ok(
    match,
    `missing SQL function ${functionName}`,
  );

  const start =
    match.index;

  const tail =
    migration.slice(
      start,
    );

  const endMatch =
    tail.match(
      /\$\$;\s*(?:\n|$)/,
    );

  assert.ok(
    endMatch,
    `missing end of SQL function ${functionName}`,
  );

  return tail.slice(
    0,
    endMatch.index
      + endMatch[0].length,
  );
}


console.log(
  "PASS R2D3D1A-01: resolution migration exists",
);


// ============================================================
// D1A-02 — post-close resolution has separate archive fields.
//
// Historical source_* snapshot fields must not be repurposed.
// ============================================================

for (
  const column
  of [
    "post_close_resolution_type",
    "post_close_corrected_text",
    "post_close_normalized_text",
    "post_close_parser_version",
    "post_close_items",
    "post_close_preview_fingerprint",
    "post_close_previewed_at",
    "post_close_resolved_at",
    "post_close_resolved_by_staff_id",
    "post_close_resolved_by_staff_code",
    "post_close_resolved_by_display_name",
  ]
) {
  assert.ok(
    migration.includes(
      column,
    ),
    `missing durable resolution field ${column}`,
  );
}

console.log(
  "PASS R2D3D1A-02: post-close resolution is separate from source snapshot",
);


// ============================================================
// D1A-03 — final outcomes are bounded.
// ============================================================

assert.match(
  migration,
  /CORRECTED/,
);

assert.match(
  migration,
  /IGNORED/,
);

console.log(
  "PASS R2D3D1A-03: post-close outcomes are CORRECTED or IGNORED",
);


// ============================================================
// D1A-04 — one dedicated atomic resolution RPC.
// ============================================================

const resolve =
  sqlFunctionBlock(
    "resolve_staff_post_close_review",
  );

console.log(
  "PASS R2D3D1A-04: dedicated post-close resolution RPC exists",
);


// ============================================================
// D1A-05 — durable archive identity is mutation grain.
// ============================================================

assert.match(
  resolve,
  /p_archive_id\s+uuid/i,
);

assert.match(
  resolve,
  /post_close_review_archive/i,
);

console.log(
  "PASS R2D3D1A-05: archive UUID is resolution identity",
);


// ============================================================
// D1A-06 — trusted ownership inputs are explicit server inputs.
// ============================================================

for (
  const required
  of [
    "p_staff_id",
    "p_allowed_line_group_ids",
    "p_expected_lease_version",
  ]
) {
  assert.ok(
    resolve.includes(
      required,
    ),
    `missing trusted resolution input ${required}`,
  );
}

console.log(
  "PASS R2D3D1A-06: Staff/scope/lease inputs are server-controlled",
);


// ============================================================
// D1A-07 — resolution supports CORRECT / IGNORE actions.
// ============================================================

assert.match(
  resolve,
  /p_action/i,
);

assert.match(
  resolve,
  /CORRECT/,
);

assert.match(
  resolve,
  /IGNORE/,
);

console.log(
  "PASS R2D3D1A-07: resolution action is bounded to CORRECT or IGNORE",
);


// ============================================================
// D1A-08 — CORRECT stores exact parser/preview snapshot.
// ============================================================

for (
  const required
  of [
    "p_corrected_text",
    "p_normalized_text",
    "p_parser_version",
    "p_items",
    "p_preview_fingerprint",
    "p_previewed_at",
  ]
) {
  assert.ok(
    resolve.includes(
      required,
    ),
    `CORRECT contract missing ${required}`,
  );
}

console.log(
  "PASS R2D3D1A-08: CORRECT carries parser and preview evidence",
);


// ============================================================
// D1A-09 — active Staff is checked inside transaction.
// ============================================================

assert.match(
  resolve,
  /staff_accounts[\s\S]*?enabled\s*=\s*true/i,
);

console.log(
  "PASS R2D3D1A-09: resolution requires active Staff",
);


// ============================================================
// D1A-10 — same advisory-lock namespace as Claim/Release.
//
// Claim/Resolve on one archive must serialize.
// ============================================================

assert.match(
  resolve,
  /pg_advisory_xact_lock/i,
);

assert.match(
  resolve,
  /staff-post-close-review-claim:/,
);

assert.match(
  resolve,
  /p_archive_id/i,
);

console.log(
  "PASS R2D3D1A-10: resolution serializes with post-close ownership",
);


// ============================================================
// D1A-11 — identity + current LINE Group authorization are
// checked together, preserving anti-enumeration.
// ============================================================

assert.match(
  resolve,
  /post_close_review_archive[\s\S]*?id\s*=\s*p_archive_id[\s\S]*?line_group_id[\s\S]*?p_allowed_line_group_ids/i,
);

assert.match(
  resolve,
  /POST_CLOSE_REVIEW_NOT_FOUND/,
);

console.log(
  "PASS R2D3D1A-11: archive identity and current Staff scope share one boundary",
);


// ============================================================
// D1A-12 — exact active claim is mandatory.
// ============================================================

assert.match(
  resolve,
  /staff_post_close_review_claims[\s\S]*?for update/i,
);

assert.match(
  resolve,
  /CLAIM_REQUIRED/,
);

assert.match(
  resolve,
  /CLAIM_EXPIRED/,
);

assert.match(
  resolve,
  /CLAIM_OWNED_BY_OTHER/,
);

assert.match(
  resolve,
  /STALE_CLAIM_VERSION/,
);

console.log(
  "PASS R2D3D1A-12: exact active lease ownership is mandatory",
);


// ============================================================
// D1A-13 — already resolved archive cannot be resolved twice.
// ============================================================

assert.match(
  resolve,
  /post_close_resolution_type/i,
);

assert.match(
  resolve,
  /POST_CLOSE_REVIEW_ALREADY_RESOLVED/,
);

console.log(
  "PASS R2D3D1A-13: post-close resolution is one-way",
);


// ============================================================
// D1A-14 — CORRECT must contain non-empty parsed items.
// ============================================================

assert.match(
  resolve,
  /jsonb_array_length/i,
);

assert.match(
  resolve,
  /CORRECTION_ITEMS_REQUIRED/,
);

assert.match(
  resolve,
  /CORRECTED_TEXT_REQUIRED/,
);

console.log(
  "PASS R2D3D1A-14: CORRECT requires durable parsed result",
);


// ============================================================
// D1A-15 — archive-only mutation.
//
// Closed canonical order/review/message rows must not be changed.
// ============================================================

for (
  const forbidden
  of [
    "insert into public.order_items",
    "update public.order_items",
    "delete from public.order_items",
    "insert into public.review_items",
    "update public.review_items",
    "delete from public.review_items",
    "insert into public.messages",
    "update public.messages",
    "delete from public.messages",
  ]
) {
  assert.equal(
    resolve
      .toLowerCase()
      .includes(
        forbidden,
      ),
    false,
    `post-close resolution must not perform ${forbidden}`,
  );
}

console.log(
  "PASS R2D3D1A-15: closed canonical rows are immutable",
);


// ============================================================
// D1A-16 — no current Settlement/latest Round dependency.
// ============================================================

for (
  const forbidden
  of [
    "fetchopensettlementsession",
    "settlement_summary_group_rounds",
    "round_no desc",
    "message_round_not_current",
    "message_outside_current_settlement",
  ]
) {
  assert.equal(
    resolve
      .toLowerCase()
      .includes(
        forbidden,
      ),
    false,
    `post-close resolution must not depend on ${forbidden}`,
  );
}

console.log(
  "PASS R2D3D1A-16: post-close resolution is independent of live lifecycle",
);


// ============================================================
// D1A-17 — source snapshot is not overwritten.
// ============================================================

for (
  const sourceField
  of [
    "source_review_status",
    "source_resolution_type",
    "source_corrected_text",
    "source_resolved_at",
    "source_resolved_by",
    "archive_reason",
  ]
) {
  const assignment =
    new RegExp(
      `${sourceField}\\s*=`,
      "i",
    );

  assert.doesNotMatch(
    resolve,
    assignment,
    `resolution must not overwrite ${sourceField}`,
  );
}

console.log(
  "PASS R2D3D1A-17: original archive snapshot remains immutable",
);


// ============================================================
// D1A-18 — successful resolution atomically clears claim.
// ============================================================

assert.match(
  resolve,
  /delete\s+from[\s\S]*?staff_post_close_review_claims/i,
);

assert.match(
  resolve,
  /lease_version[\s\S]*?p_expected_lease_version/i,
);

console.log(
  "PASS R2D3D1A-18: successful resolution atomically releases claim",
);


// ============================================================
// D1A-19 — durable Staff audit snapshot.
// ============================================================

for (
  const auditField
  of [
    "post_close_resolved_by_staff_id",
    "post_close_resolved_by_staff_code",
    "post_close_resolved_by_display_name",
    "post_close_resolved_at",
  ]
) {
  assert.ok(
    resolve.includes(
      auditField,
    ),
    `resolution audit missing ${auditField}`,
  );
}

console.log(
  "PASS R2D3D1A-19: resolution records durable Staff audit identity",
);


// ============================================================
// D1A-20 — RPC remains service-role only.
// ============================================================

assert.match(
  migration,
  /revoke[\s\S]*?resolve_staff_post_close_review[\s\S]*?from public,\s*anon,\s*authenticated/i,
);

assert.match(
  migration,
  /grant execute[\s\S]*?resolve_staff_post_close_review[\s\S]*?to service_role/i,
);

console.log(
  "PASS R2D3D1A-20: post-close resolution RPC is server-side only",
);


// ============================================================
// D1A-21 — lease expiry uses a clock refreshed after claim lock.
//
// A lease expiring while Resolution waits on serialization must
// never be accepted using an earlier timestamp.
// ============================================================

assert.match(
  resolve,
  /staff_post_close_review_claims[\s\S]*?for update[\s\S]*?v_now\s*:=\s*clock_timestamp\(\)[\s\S]*?claim_expires_at[\s\S]*?CLAIM_EXPIRED/i,
);

console.log(
  "PASS R2D3D1A-21: lease expiry clock is refreshed after ownership lock",
);


// ============================================================
// D1A-22 — JSON shape is checked before array length.
//
// jsonb_array_length() must only execute after an array-shape
// validation has already passed.
// ============================================================

assert.match(
  resolve,
  /jsonb_typeof[\s\S]*?CORRECTION_ITEMS_REQUIRED[\s\S]*?jsonb_array_length[\s\S]*?CORRECTION_ITEMS_REQUIRED/i,
);

console.log(
  "PASS R2D3D1A-22: item shape is validated before array length",
);


console.log(
  "PASS: Staff Post-close Review Resolution Foundation v9.23",
);
