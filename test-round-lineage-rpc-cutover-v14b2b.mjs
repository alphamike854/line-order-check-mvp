import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/20260915044000_cut_review_verification_rpcs_to_round_lineage.sql",
    "utf8",
  );


const executableSql =
  migration
    .replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    )
    .replace(
      /--.*$/gm,
      "",
    );


function normalizeArgs(
  raw,
) {
  return raw
    .split(",")
    .map(
      (part) =>
        part
          .replace(
            /\s+default\s+.*$/is,
            "",
          )
          .replace(
            /\s+/g,
            " ",
          )
          .trim()
          .toLowerCase(),
    )
    .filter(Boolean)
    .join(", ");
}


const header =
  /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns\b/gi;


const definitions = [
  ...migration.matchAll(
    header,
  ),
].map(
  (match) => ({
    name:
      match[1]
        .toLowerCase(),

    args:
      normalizeArgs(
        match[2],
      ),
  }),
);


const expected = new Set([
  "assert_staff_review_resolution_claim|p_review_id bigint, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_expected_lease_version bigint",

  "claim_staff_review_work|p_message_record_id uuid, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_lease_seconds integer",

  "release_staff_review_work|p_message_record_id uuid, p_staff_id uuid, p_settlement_session_id uuid, p_expected_lease_version bigint",

  "claim_staff_message_verification_work|p_message_record_id uuid, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_lease_seconds integer",

  "verify_staff_message_order|p_message_record_id uuid, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_expected_lease_version bigint, p_expected_parser_version text, p_expected_normalized_text text, p_expected_order_items jsonb",

  "correct_staff_message_verification_order|p_message_record_id uuid, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_expected_lease_version bigint, p_expected_parser_version text, p_expected_normalized_text text, p_expected_order_items jsonb, p_corrected_text text, p_corrected_parser_version text, p_corrected_normalized_text text, p_corrected_order_items jsonb, p_corrected_first_order_code text",

  "resolve_review_with_items|p_review_id bigint, p_corrected_text text, p_parser_version text, p_items jsonb, p_resolved_by text",
]);


const actual =
  new Set(
    definitions.map(
      ({ name, args }) =>
        `${name}|${args}`,
    ),
  );


assert.equal(
  definitions.length,
  7,
);

assert.deepEqual(
  actual,
  expected,
);

console.log(
  "PASS V14B2B-01: exactly seven CORE signatures are replaced",
);


assert.doesNotMatch(
  executableSql,
  /\bpublic\.settlement_line_group_config\b/i,
);

assert.match(
  executableSql,
  /\bpublic\.settlement_line_group_round_config\b/i,
);

console.log(
  "PASS V14B2B-02: CORE membership uses immutable Round lineage",
);


const lineageRefs =
  executableSql.match(
    /public\.settlement_line_group_round_config/g,
  )
  || [];

assert.ok(
  lineageRefs.length >= 9,
);

console.log(
  "PASS V14B2B-03: lineage checks cover guards and all CORE RPCs",
);


assert.equal(
  definitions.filter(
    (row) =>
      row.name
      === "claim_staff_review_work",
  ).length,
  1,
);

assert.equal(
  definitions.filter(
    (row) =>
      row.name
      === "release_staff_review_work",
  ).length,
  1,
);

console.log(
  "PASS V14B2B-04: compatibility overload wrappers are not replaced",
);


assert.match(
  executableSql,
  /v_summary_group_id\s*:=\s*v_message\.summary_group_id/i,
);

assert.doesNotMatch(
  executableSql,
  /update\s+public\.messages\s+set\s+summary_group_id\s*=/i,
);

console.log(
  "PASS V14B2B-05: Review correction derives group from accepted message",
);


assert.doesNotMatch(
  executableSql,
  /update\s+public\.messages\s+set[\s\S]{0,600}?\bsummary_group_round_id\s*=/i,
);

assert.doesNotMatch(
  executableSql,
  /update\s+public\.messages\s+set[\s\S]{0,600}?\bsummary_group_id\s*=/i,
);

console.log(
  "PASS V14B2B-06: accepted message ownership is never rewritten",
);


const mismatchCodes =
  executableSql.match(
    /MESSAGE_LINE_GROUP_CONFIG_MISMATCH/g,
  )
  || [];

assert.ok(
  mismatchCodes.length >= 6,
);

assert.match(
  executableSql,
  /MESSAGE_GROUP_NOT_CONFIGURED/,
);

console.log(
  "PASS V14B2B-07: existing external mismatch errors remain stable",
);


assert.match(
  executableSql,
  /V14B2B_MESSAGE_LINEAGE_REQUIRED/,
);

assert.match(
  executableSql,
  /V14B2B_ORDER_ITEM_LINEAGE_REQUIRED/,
);

console.log(
  "PASS V14B2B-08: migration fails closed on missing lineage",
);


// Check executable SQL only.
// Comments may legitimately document excluded responsibilities.
assert.doesNotMatch(
  executableSql,
  /\bsave_line_group_live\b/i,
);

assert.doesNotMatch(
  executableSql,
  /\b(EAST|WEST|CENTRAL|NORTH|SOUTH)\b/,
);

console.log(
  "PASS V14B2B-09: remap implementation and region special-casing remain outside phase",
);


assert.doesNotMatch(
  executableSql,
  /assign_message_to_open_settlement/i,
);

assert.doesNotMatch(
  executableSql,
  /populate_message_verification_durable_context/i,
);

assert.doesNotMatch(
  executableSql,
  /enforce_order_item_summary_group_accepting/i,
);

console.log(
  "PASS V14B2B-10: admission and trigger boundaries remain untouched",
);


const revokeCount =
  (
    executableSql.match(
      /revoke all[\s\S]*?from public, anon, authenticated;/gi,
    )
    || []
  ).length;

const grantCount =
  (
    executableSql.match(
      /grant execute[\s\S]*?to service_role;/gi,
    )
    || []
  ).length;

assert.equal(
  revokeCount,
  7,
);

assert.equal(
  grantCount,
  7,
);

console.log(
  "PASS V14B2B-11: all seven CORE signatures retain server-only execution",
);


console.log(
  "PASS: V14B2B Round-lineage RPC cutover contract",
);
