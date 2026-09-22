import assert from "node:assert/strict";
import fs from "node:fs";

import {
  normalizeExportReadyRequest,
} from "./src/lib/export-preparation-ready-request.mjs";


const migration =
  fs.readFileSync(
    "supabase/migrations/20260922074500_add_export_preparation_ready_rpc.sql",
    "utf8",
  );

const endpoint =
  fs.readFileSync(
    "netlify/functions/export-preparation-ready.mjs",
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


console.log(
  "===== Export Preparation READY API v1 =====",
);


assert.ok(
  sql.includes(
    "create or replace function public.mark_export_preparation_ready(",
  ),
);

console.log(
  "PASS EXP2C-01: atomic READY RPC exists",
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
  "PASS EXP2C-02: READY locks and requires exact OPEN Round",
);


assert.ok(
  sql.includes(
    "v_cycle.status <> 'DRAFT'",
  ),
);

assert.ok(
  sql.includes(
    "v_cycle.status = 'READY'",
  ),
);

assert.ok(
  sql.includes(
    "idempotent_replay",
  ),
);

console.log(
  "PASS EXP2C-03: only DRAFT transitions; same READY retry is idempotent",
);


assert.ok(
  sql.includes(
    "EXPORT_READY_DESTINATION_CONFLICT",
  ),
);

console.log(
  "PASS EXP2C-04: READY retry cannot silently change destination",
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
    "EXPORT_DRAFT_STALE_AVAILABILITY",
  ),
);

console.log(
  "PASS EXP2C-05: READY revalidates live current minus same-Round SENT",
);


assert.ok(
  sql.includes(
    "ready_current_effective_quantity",
  ),
);

assert.ok(
  sql.includes(
    "ready_prior_sent_quantity",
  ),
);

assert.ok(
  sql.includes(
    "ready_available_quantity",
  ),
);

assert.ok(
  sql.includes(
    "ready_validated_at",
  ),
);

console.log(
  "PASS EXP2C-06: READY snapshot is preserved separately from DRAFT snapshot",
);


assert.ok(
  sql.includes(
    "status = 'READY'",
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

assert.ok(
  sql.includes(
    "ready_by",
  ),
);

console.log(
  "PASS EXP2C-07: READY locks operator destination and attribution",
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
  "PASS EXP2C-08: READY mutation requires Dashboard authentication",
);


assert.ok(
  api.includes(
    "EXPORT_PREPARATION_STALE_ROUND",
  ),
);

assert.ok(
  api.includes(
    "round.id !== request.round_id",
  ),
);

console.log(
  "PASS EXP2C-09: browser cannot READY a stale Round",
);


assert.ok(
  api.includes(
    '"mark_export_preparation_ready"',
  ),
);

assert.ok(
  !api.includes(
    ".insert(",
  ),
);

assert.ok(
  !api.includes(
    ".update(",
  ),
);

assert.ok(
  !api.includes(
    ".delete(",
  ),
);

console.log(
  "PASS EXP2C-10: application READY mutation is RPC-only",
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
  "PASS EXP2C-11: Allocation/confirmed-cut storage remains isolated",
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

}

console.log(
  "PASS EXP2C-12: READY has no LINE transport",
);


/*
 * Critical semantic:
 * READY may inspect/reject an already-SENT cycle,
 * but Phase 2C must never WRITE status=SENT.
 */
assert.doesNotMatch(
  sql,
  /update public\.settlement_export_cycles set [^;]*status\s*=\s*'SENT'/i,
);

assert.doesNotMatch(
  sql,
  /insert into public\.settlement_export_cycles [^;]*'SENT'/i,
);

console.log(
  "PASS EXP2C-13: READY may guard SENT but cannot write cycle SENT",
);


const normalized =
  normalizeExportReadyRequest({
    round_id:
      "11111111-1111-4111-8111-111111111111",

    cycle_id:
      "22222222-2222-4222-8222-222222222222",

    destination_line_group_id:
      "C1234567890",

    destination_label:
      "คลัง 1",
  });


assert.deepEqual(
  normalized,
  {
    round_id:
      "11111111-1111-4111-8111-111111111111",

    cycle_id:
      "22222222-2222-4222-8222-222222222222",

    destination_line_group_id:
      "C1234567890",

    destination_label:
      "คลัง 1",
  },
);

console.log(
  "PASS EXP2C-14: READY request preserves destination",
);


assert.throws(
  () =>
    normalizeExportReadyRequest({
      round_id:
        "11111111-1111-4111-8111-111111111111",

      cycle_id:
        "22222222-2222-4222-8222-222222222222",

      destination_line_group_id:
        "",
    }),
  /INVALID_DESTINATION_LINE_GROUP_ID/,
);

console.log(
  "PASS EXP2C-15: missing destination fails closed",
);


assert.ok(
  migration.includes(
    "READY is not a reservation",
  ),
);

assert.ok(
  migration.includes(
    "SENT phase must revalidate again",
  ),
);

console.log(
  "PASS EXP2C-16: READY explicitly remains non-reserving",
);


assert.ok(
  pkg.includes(
    "test-export-preparation-ready-api-v1.mjs",
  ),
);

console.log(
  "PASS EXP2C-17: Phase 2C registered in full regression",
);


console.log(
  "PASS: Export Preparation READY API v1",
);
