import assert from "node:assert/strict";
import fs from "node:fs";

import {
  normalizeExportDraftRequest,
} from "./src/lib/export-preparation-draft-request.mjs";

const migration =
  fs.readFileSync(
    "supabase/migrations/20260922073500_add_export_preparation_draft_rpc.sql",
    "utf8",
  );

const endpoint =
  fs.readFileSync(
    "netlify/functions/export-preparation-draft.mjs",
    "utf8",
  );

const pkg =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

const sql =
  migration
    .replace(/\s+/g, " ");

const api =
  endpoint
    .replace(/\s+/g, " ");

console.log(
  "===== Export Preparation DRAFT API v1 =====",
);

assert.ok(
  sql.includes(
    "create or replace function public.create_export_preparation_draft(",
  ),
);
console.log(
  "PASS EXP2B-01: atomic DRAFT RPC exists",
);

assert.ok(
  sql.includes(
    "pg_advisory_xact_lock",
  ),
);

assert.ok(
  sql.includes(
    "for update",
  ),
);

console.log(
  "PASS EXP2B-02: Round DRAFT creation is serialized",
);

assert.ok(
  sql.includes(
    "v_round.status <> 'OPEN'",
  ),
);

console.log(
  "PASS EXP2B-03: DB requires OPEN Round",
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

console.log(
  "PASS EXP2B-04: DB recomputes current minus same-Round SENT",
);

assert.ok(
  sql.includes(
    "EXPORT_QUANTITY_EXCEEDS_AVAILABLE",
  ),
);

console.log(
  "PASS EXP2B-05: selected DRAFT cannot exceed live availability",
);

assert.ok(
  sql.includes(
    "status, client_request_id, request_fingerprint, created_by",
  ),
);

assert.ok(
  sql.includes(
    "'DRAFT'",
  ),
);

console.log(
  "PASS EXP2B-06: mutation creates DRAFT only",
);

assert.ok(
  sql.includes(
    "settlement_export_cycles_request_id_idx",
  ),
);

assert.ok(
  sql.includes(
    "EXPORT_CLIENT_REQUEST_CONFLICT",
  ),
);

assert.ok(
  sql.includes(
    "idempotent_replay",
  ),
);

console.log(
  "PASS EXP2B-07: client_request_id makes retries idempotent",
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
  "PASS EXP2B-08: POST mutation requires Dashboard authentication",
);

assert.ok(
  api.includes(
    "EXPORT_PREPARATION_STALE_ROUND",
  ),
);

assert.ok(
  api.includes(
    'round.id !== request.round_id',
  ),
);

console.log(
  "PASS EXP2B-09: stale browser Round cannot prepare into a new Round",
);

assert.ok(
  api.includes(
    '"create_export_preparation_draft"',
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
  "PASS EXP2B-10: application mutation is RPC-only",
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
  "PASS EXP2B-11: Allocation/confirmed-cut storage remains isolated",
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
  "PASS EXP2B-12: DRAFT path has no LINE transport",
);

const normalized =
  normalizeExportDraftRequest({
    round_id:
      "11111111-1111-4111-8111-111111111111",

    client_request_id:
      "22222222-2222-4222-8222-222222222222",

    items: [
      {
        category:
          "a",

        code:
          "59",

        selected_send_quantity:
          1500,
      },
    ],
  });

assert.deepEqual(
  normalized.items,
  [
    {
      category:
        "A",

      code:
        "59",

      selected_send_quantity:
        1500,
    },
  ],
);

console.log(
  "PASS EXP2B-13: request normalization preserves operator quantity",
);

assert.throws(
  () =>
    normalizeExportDraftRequest({
      round_id:
        "11111111-1111-4111-8111-111111111111",

      client_request_id:
        "22222222-2222-4222-8222-222222222222",

      items: [
        {
          category:
            "A",
          code:
            "59",
          selected_send_quantity:
            500,
        },
        {
          category:
            "A",
          code:
            "59",
          selected_send_quantity:
            1000,
        },
      ],
    }),
  /DUPLICATE_EXPORT_CODE/,
);

console.log(
  "PASS EXP2B-14: one code appears at most once in one DRAFT",
);

assert.throws(
  () =>
    normalizeExportDraftRequest({
      round_id:
        "11111111-1111-4111-8111-111111111111",

      client_request_id:
        "22222222-2222-4222-8222-222222222222",

      items: [
        {
          category:
            "A",
          code:
            "59",
          selected_send_quantity:
            0,
        },
      ],
    }),
  /INVALID_SELECTED_SEND_QUANTITY/,
);

console.log(
  "PASS EXP2B-15: zero/negative operator quantity is rejected",
);

assert.ok(
  !migration.includes(
    "% 500",
  ),
);

assert.ok(
  !migration.includes(
    "500/1000",
  ),
);

console.log(
  "PASS EXP2B-16: DB does not lock a 500-unit policy",
);

assert.ok(
  pkg.includes(
    "test-export-preparation-draft-api-v1.mjs",
  ),
);

console.log(
  "PASS EXP2B-17: Phase 2B registered in full regression",
);

console.log(
  "PASS: Export Preparation DRAFT API v1",
);
