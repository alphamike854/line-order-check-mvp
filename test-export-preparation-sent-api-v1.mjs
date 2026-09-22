import assert from "node:assert/strict";
import fs from "node:fs";

import {
  normalizeExportSentRequest,
} from "./src/lib/export-preparation-sent-request.mjs";


const migration =
  fs.readFileSync(
    "supabase/migrations/20260922090000_add_export_preparation_sent_rpc.sql",
    "utf8",
  );

const endpoint =
  fs.readFileSync(
    "netlify/functions/export-preparation-sent.mjs",
    "utf8",
  );

const foundation =
  fs.readFileSync(
    "supabase/migrations/20260922072000_add_export_preparation_round_foundation.sql",
    "utf8",
  );

const pkg =
  fs.readFileSync(
    "package.json",
    "utf8",
  );


const sql =
  migration.replace(
    /\s+/g,
    " ",
  );

const api =
  endpoint.replace(
    /\s+/g,
    " ",
  );

const base =
  foundation.replace(
    /\s+/g,
    " ",
  );


console.log(
  "===== Export Preparation SENT API v1 =====",
);


assert.ok(
  sql.includes(
    "create or replace function public.mark_export_preparation_sent(",
  ),
);

console.log(
  "PASS EXP2D-01: atomic SENT RPC exists",
);


assert.ok(
  sql.includes(
    "from public.settlement_summary_group_rounds r",
  ),
);

assert.ok(
  sql.includes(
    "for update",
  ),
);

assert.ok(
  sql.includes(
    "v_round.status <> 'OPEN'",
  ),
);

console.log(
  "PASS EXP2D-02: Round row serializes final SENT boundary",
);


assert.ok(
  sql.includes(
    "v_cycle.status = 'SENT'",
  ),
);

assert.ok(
  sql.includes(
    "idempotent_replay",
  ),
);

assert.ok(
  sql.includes(
    "v_cycle.status <> 'READY'",
  ),
);

console.log(
  "PASS EXP2D-03: SENT retry is idempotent and only READY can transition",
);


assert.ok(
  sql.includes(
    "EXPORT_READY_STATE_INVALID",
  ),
);

assert.ok(
  sql.includes(
    "destination_line_group_id",
  ),
);

assert.ok(
  sql.includes(
    "ready_at",
  ),
);

console.log(
  "PASS EXP2D-04: SENT requires valid READY destination state",
);


assert.ok(
  sql.includes(
    "EXPORT_READY_SNAPSHOT_MISSING",
  ),
);

console.log(
  "PASS EXP2D-05: corrupted READY snapshot fails closed",
);


assert.ok(
  sql.includes(
    "dashboard_risk_snapshot(",
  ),
);

assert.ok(
  sql.includes(
    "settlement_export_sent_totals",
  ),
);

assert.ok(
  sql.includes(
    "greatest( v_current - v_prior, 0 )",
  ),
);

assert.ok(
  sql.includes(
    "EXPORT_READY_STALE_AVAILABILITY",
  ),
);

console.log(
  "PASS EXP2D-06: SENT revalidates current minus same-Round SENT",
);


assert.ok(
  sql.includes(
    "sent_current_effective_quantity",
  ),
);

assert.ok(
  sql.includes(
    "sent_prior_sent_quantity",
  ),
);

assert.ok(
  sql.includes(
    "sent_available_quantity",
  ),
);

assert.ok(
  sql.includes(
    "sent_validated_at",
  ),
);

console.log(
  "PASS EXP2D-07: final SENT validation snapshot is durable",
);


assert.ok(
  sql.includes(
    "status = 'SENT'",
  ),
);

assert.ok(
  sql.includes(
    "sent_at = v_sent_at",
  ),
);

assert.ok(
  sql.includes(
    "sent_by = coalesce(",
  ),
);

console.log(
  "PASS EXP2D-08: READY transitions to SENT with attribution",
);


/*
 * Only the cycle status may cross into SENT.
 * Operator quantity is immutable.
 */
assert.doesNotMatch(
  sql,
  /update public\.settlement_export_items set [^;]*selected_send_quantity\s*=/i,
);

console.log(
  "PASS EXP2D-09: SENT cannot rewrite operator-selected quantity",
);


/*
 * Existing foundation view remains the cumulative source
 * and counts only SENT cycles.
 *
 * Match SQL semantics rather than capitalization/formatting.
 */
assert.match(
  base,
  /where\s+c\.status\s*=\s*'SENT'/i,
);

assert.match(
  base,
  /sum\s*\(\s*i\.selected_send_quantity\s*\)/i,
);

console.log(
  "PASS EXP2D-10: status SENT activates existing cumulative ledger",
);


assert.ok(
  api.includes(
    'req.method !== "POST"',
  ),
);

assert.ok(
  api.includes(
    "requireDashboardAccess(req)",
  ),
);

console.log(
  "PASS EXP2D-11: SENT foundation requires Dashboard authentication",
);


/*
 * Phase 2E retires the direct SENT HTTP boundary entirely.
 *
 * A browser can no longer choose any Round through this route;
 * stale-Round enforcement now belongs to the delivery endpoint.
 */
assert.ok(
  api.includes(
    "EXPORT_SENT_DIRECT_DISABLED",
  ),
);

assert.ok(
  api.includes(
    "/api/export-preparation-send",
  ),
);

console.log(
  "PASS EXP2D-12: direct SENT route cannot bypass Phase 2E Round guards",
);


assert.ok(
  api.includes(
    "EXPORT_SENT_DIRECT_DISABLED",
  ),
);

assert.ok(
  !api.includes(
    '"mark_export_preparation_sent"',
  ),
);

console.log(
  "PASS EXP2D-13: direct SENT HTTP mutation retired by Phase 2E",
);


assert.ok(
  api.includes(
    "/api/export-preparation-send",
  ),
);

console.log(
  "PASS EXP2D-14: direct SENT route points to acknowledgement boundary",
);


for (const source of [
  migration,
  endpoint,
]) {

  assert.ok(
    !source.includes(
      "settlement_transfer_batches",
    ),
  );

  assert.ok(
    !source.includes(
      "settlement_transfer_batch_items",
    ),
  );

  assert.ok(
    !source.includes(
      "confirmed_cut_total",
    ),
  );

}

console.log(
  "PASS EXP2D-15: Allocation/confirmed-cut storage remains isolated",
);


for (const source of [
  migration,
  endpoint,
]) {

  assert.ok(
    !source.includes(
      "LINE_MESSAGE_MIRROR_ENABLED",
    ),
  );

  assert.ok(
    !source.includes(
      "api.line.me",
    ),
  );

  assert.ok(
    !source.includes(
      "pushMessage",
    ),
  );

  assert.ok(
    !source.includes(
      "line-message-mirror",
    ),
  );

}

console.log(
  "PASS EXP2D-16: Phase 2D contains no LINE transport",
);


const normalized =
  normalizeExportSentRequest({
    round_id:
      "11111111-1111-4111-8111-111111111111",

    cycle_id:
      "22222222-2222-4222-8222-222222222222",

    selected_send_quantity:
      999999,

    destination_line_group_id:
      "MUST_NOT_BE_TRUSTED",
  });


assert.deepEqual(
  normalized,
  {
    round_id:
      "11111111-1111-4111-8111-111111111111",

    cycle_id:
      "22222222-2222-4222-8222-222222222222",
  },
);

console.log(
  "PASS EXP2D-17: SENT browser request cannot alter quantity or destination",
);


/*
 * Concurrency semantic:
 *
 * The authoritative Round row must be locked before reading
 * same-Round SENT cumulative and before crossing status -> SENT.
 *
 * Test executable SQL ordering, not comment formatting.
 */
const roundLockPosition =
  sql.search(
    /select r\.\* into v_round from public\.settlement_summary_group_rounds r where r\.id = p_expected_summary_group_round_id for update;/i,
  );

const sentCumulativePosition =
  sql.search(
    /from public\.settlement_export_sent_totals s/i,
  );

const sentTransitionPosition =
  sql.search(
    /update public\.settlement_export_cycles set status = 'SENT'/i,
  );

assert.ok(
  roundLockPosition >= 0,
);

assert.ok(
  sentCumulativePosition >
    roundLockPosition,
);

assert.ok(
  sentTransitionPosition >
    sentCumulativePosition,
);

console.log(
  "PASS EXP2D-18: Round locks before cumulative read and SENT transition",
);


assert.ok(
  pkg.includes(
    "test-export-preparation-sent-api-v1.mjs",
  ),
);

console.log(
  "PASS EXP2D-19: Phase 2D registered in full regression",
);


console.log(
  "PASS: Export Preparation SENT API v1",
);
