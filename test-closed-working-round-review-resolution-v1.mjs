import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/"
  + "20260913161000_allow_closed_current_round_review_resolution.sql";

const migration =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const packageJson =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

const staffGuard =
  fs.readFileSync(
    "supabase/migrations/"
    + "20260902170000_add_staff_review_resolution_guard.sql",
    "utf8",
  );

const admission =
  fs.readFileSync(
    "supabase/migrations/"
    + "20260912001000_add_round_owned_message_admission.sql",
    "utf8",
  );

function section(
  text,
  startToken,
  endToken,
) {
  const start =
    text.indexOf(startToken);

  assert.notEqual(
    start,
    -1,
    `missing ${startToken}`,
  );

  const end =
    text.indexOf(
      endToken,
      start + startToken.length,
    );

  assert.notEqual(
    end,
    -1,
    `missing ${endToken}`,
  );

  return text.slice(
    start,
    end,
  );
}


// CWR1-01
assert.match(
  migration,
  /create\s+or\s+replace\s+function\s+public\.resolve_review_with_items/i,
);


// CWR1-02
assert.match(
  migration,
  /settlement_summary_group_rounds[\s\S]*order by[\s\S]*round_no desc[\s\S]*limit 1/i,
);

assert.match(
  migration,
  /MESSAGE_ROUND_NOT_CURRENT/,
);


// CWR1-03
assert.match(
  migration,
  /set_config\([\s\S]*line_order\.current_working_round_review_message_id[\s\S]*v_message\.id::text[\s\S]*true/i,
);


// CWR1-04
const trigger =
  section(
    migration,
    "public.enforce_order_item_summary_group_accepting()",
    "comment on function\n  public.enforce_order_item_summary_group_accepting()",
  );

assert.match(
  trigger,
  /current_setting\([\s\S]*line_order\.accepted_message_persistence_id/,
);

assert.match(
  trigger,
  /current_setting\([\s\S]*line_order\.current_working_round_review_message_id/,
);


// CWR1-05
const reviewBypassStart =
  trigger.indexOf(
    "Current Working Round Review correction",
  );

const ordinaryGuardStart =
  trigger.indexOf(
    "All other canonical mutation retains the original S1 guard",
  );

assert.ok(
  reviewBypassStart >= 0,
  "missing Review bypass",
);

assert.ok(
  ordinaryGuardStart > reviewBypassStart,
  "ordinary guard must remain after Review bypass",
);

const reviewBypass =
  trigger.slice(
    reviewBypassStart,
    ordinaryGuardStart,
  );

assert.match(
  reviewBypass,
  /v_review_message_id[\s\S]*new\.message_record_id::text/,
);

assert.match(
  reviewBypass,
  /v_message_round_id[\s\S]*v_latest_round_id[\s\S]*MESSAGE_ROUND_NOT_CURRENT/,
);

assert.match(
  reviewBypass,
  /settlement_sessions[\s\S]*s\.status\s*=\s*'OPEN'/i,
);


// CWR1-06
// Inspect executable SQL only. A documentation comment intentionally
// mentions the forbidden predicate to explain why it is absent.
const reviewBypassCode =
  reviewBypass
    .split("\n")
    .map(
      (line) =>
        line.replace(
          /--.*$/,
          "",
        ),
    )
    .join("\n");

assert.doesNotMatch(
  reviewBypassCode,
  /r\.status\s*=\s*'OPEN'/i,
);


// CWR1-07
const ordinaryGuard =
  trigger.slice(
    ordinaryGuardStart,
  );

assert.match(
  ordinaryGuard,
  /is_settlement_summary_group_accepting/,
);

assert.match(
  ordinaryGuard,
  /SUMMARY_GROUP_CLOSED/,
);


// CWR1-08
assert.match(
  admission,
  /line_order\.accepted_message_persistence_id/,
);

assert.match(
  admission,
  /Do NOT re-check current OPEN\/CLOSED state/i,
);


// CWR1-09
assert.match(
  staffGuard,
  /Latest Round is authoritative whether that Round is OPEN or[\s\S]*CLOSED/i,
);

assert.match(
  staffGuard,
  /round_no desc[\s\S]*MESSAGE_ROUND_NOT_CURRENT/i,
);


// CWR1-10
assert.ok(
  packageJson.includes(
    "test-closed-working-round-review-resolution-v1.mjs",
  ),
  "new contract must join npm test",
);


console.log(
  "PASS CWR1-01: canonical Review resolution is hardened",
);

console.log(
  "PASS CWR1-02: Review resolution requires latest Working Round",
);

console.log(
  "PASS CWR1-03: Review correction installs exact-message transaction marker",
);

console.log(
  "PASS CWR1-04: parser/OCR and Review markers remain separate",
);

console.log(
  "PASS CWR1-05: Review bypass verifies exact message, parent settlement, and latest Round",
);

console.log(
  "PASS CWR1-06: latest CLOSED Round is intentionally eligible",
);

console.log(
  "PASS CWR1-07: ordinary CLOSED canonical writes remain blocked",
);

console.log(
  "PASS CWR1-08: admitted parser/OCR bypass remains intact",
);

console.log(
  "PASS CWR1-09: Staff previous-round rejection remains authoritative",
);

console.log(
  "PASS CWR1-10: contract joins full regression",
);

console.log(
  "PASS: Closed Current Working Round Review Resolution v1",
);
