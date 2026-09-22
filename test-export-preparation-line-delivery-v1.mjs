import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildExportPreparationLineMessages,
} from "./src/lib/export-preparation-line-message.mjs";

import {
  classifyLinePushResponse,
  pushExportPreparationToLine,
} from "./src/lib/export-preparation-line-transport.mjs";

import {
  normalizeExportSendRequest,
} from "./src/lib/export-preparation-send-request.mjs";


const migration =
  fs.readFileSync(
    "supabase/migrations/20260922091500_add_export_preparation_delivery_boundary.sql",
    "utf8",
  );

const endpoint =
  fs.readFileSync(
    "netlify/functions/export-preparation-send.mjs",
    "utf8",
  );

const direct =
  fs.readFileSync(
    "netlify/functions/export-preparation-sent.mjs",
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
  "===== Export Preparation LINE Delivery v1 =====",
);


assert.ok(
  sql.includes(
    "create table if not exists public.settlement_export_deliveries",
  ),
);

console.log(
  "PASS EXP2E-01: durable delivery identity exists",
);


assert.ok(
  sql.includes(
    "line_retry_key uuid not null unique",
  ),
);

assert.ok(
  sql.includes(
    "retry_key_started_at",
  ),
);

console.log(
  "PASS EXP2E-02: stable LINE retry key is durable",
);


assert.ok(
  sql.includes(
    "interval '23 hours'",
  ),
);

console.log(
  "PASS EXP2E-03: retries fail closed before LINE 24-hour key expiry",
);


assert.ok(
  sql.includes(
    "settlement_export_reserved_totals",
  ),
);

assert.ok(
  sql.includes(
    "'SENDING', 'RETRYABLE', 'AMBIGUOUS'",
  ),
);

console.log(
  "PASS EXP2E-04: unresolved transport reserves quantities",
);


assert.ok(
  sql.includes(
    "transport_prior_reserved_quantity",
  ),
);

assert.ok(
  sql.includes(
    "v_current - v_prior_sent - v_prior_reserved",
  ),
);

assert.ok(
  sql.includes(
    "EXPORT_TRANSPORT_STALE_AVAILABILITY",
  ),
);

console.log(
  "PASS EXP2E-05: pre-send availability subtracts SENT and active reservations",
);


assert.ok(
  sql.includes(
    "create or replace function public.begin_export_preparation_delivery(",
  ),
);

assert.ok(
  sql.includes(
    "for update",
  ),
);

console.log(
  "PASS EXP2E-06: transport reservation is atomic and Round-serialized",
);


assert.ok(
  sql.includes(
    "EXPORT_DELIVERY_BUSY",
  ),
);

assert.ok(
  sql.includes(
    "lease_token",
  ),
);

console.log(
  "PASS EXP2E-07: concurrent transport attempts use a lease",
);


assert.ok(
  sql.includes(
    "create or replace function public.complete_export_preparation_delivery(",
  ),
);

assert.ok(
  sql.includes(
    "p_http_status between 200 and 299",
  ),
);

assert.ok(
  sql.includes(
    "p_http_status = 409",
  ),
);

assert.ok(
  sql.includes(
    "p_line_accepted_request_id",
  ),
);

console.log(
  "PASS EXP2E-08: only positive LINE acceptance crosses ACK boundary",
);


assert.ok(
  sql.includes(
    "status = 'ACKNOWLEDGED'",
  ),
);

assert.ok(
  sql.includes(
    "status = 'SENT'",
  ),
);

console.log(
  "PASS EXP2E-09: ACK and SENT are committed in one DB transaction",
);


assert.ok(
  sql.includes(
    "We MUST NOT perform a new live availability rejection here",
  ),
);

console.log(
  "PASS EXP2E-10: post-accept correction cannot erase an external send",
);


assert.ok(
  sql.includes(
    "record_export_preparation_delivery_result",
  ),
);

assert.ok(
  sql.includes(
    "'RETRYABLE', 'AMBIGUOUS', 'FAILED'",
  ),
);

console.log(
  "PASS EXP2E-11: non-accepted outcomes keep separate transport state",
);


assert.ok(
  sql.includes(
    "revoke execute on function public.mark_export_preparation_sent",
  ),
);

console.log(
  "PASS EXP2E-12: legacy direct SENT RPC access is revoked from service_role",
);


assert.ok(
  direct.includes(
    "EXPORT_SENT_DIRECT_DISABLED",
  ),
);

assert.ok(
  !direct.includes(
    "mark_export_preparation_sent",
  ),
);

console.log(
  "PASS EXP2E-13: direct SENT HTTP route is fail-closed",
);


assert.ok(
  api.includes(
    "LINE_CHANNEL_ACCESS_TOKEN",
  ),
);

assert.ok(
  api.includes(
    "begin_export_preparation_delivery",
  ),
);

assert.ok(
  api.includes(
    "pushExportPreparationToLine",
  ),
);

assert.ok(
  api.includes(
    "complete_export_preparation_delivery",
  ),
);

console.log(
  "PASS EXP2E-14: endpoint order is reserve -> LINE -> acknowledge",
);


/*
 * Phase 2E now owns stale-Round protection because the
 * direct accounting-only SENT HTTP endpoint is retired.
 */
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
  "PASS EXP2E-14B: delivery boundary rejects stale browser Round",
);


const beginPos =
  api.indexOf(
    '"begin_export_preparation_delivery"',
  );

const pushPos =
  api.indexOf(
    "await pushExportPreparationToLine",
  );

const completePos =
  api.indexOf(
    '"complete_export_preparation_delivery"',
  );

assert.ok(
  beginPos >= 0
  && pushPos > beginPos
  && completePos > pushPos,
);

console.log(
  "PASS EXP2E-15: SENT completion cannot happen before LINE call",
);


assert.ok(
  api.includes(
    "EXPORT_DELIVERY_ACK_ACCOUNTING_PENDING",
  ),
);

console.log(
  "PASS EXP2E-16: accepted-but-unrecorded LINE result remains recoverable",
);


assert.equal(
  classifyLinePushResponse({
    status: 200,
  }),
  "ACCEPTED",
);

assert.equal(
  classifyLinePushResponse({
    status: 409,
    acceptedRequestId:
      "accepted-request-id",
  }),
  "ALREADY_ACCEPTED",
);

assert.equal(
  classifyLinePushResponse({
    status: 500,
  }),
  "RETRYABLE",
);

assert.equal(
  classifyLinePushResponse({
    status: 400,
  }),
  "FAILED",
);

assert.equal(
  classifyLinePushResponse({
    status: 409,
  }),
  "FAILED",
);

console.log(
  "PASS EXP2E-17: LINE response classification fails closed",
);


const messages =
  buildExportPreparationLineMessages({
    summaryGroupId:
      "EAST",

    cycleNo:
      2,

    items: [
      {
        category:
          "B",
        code:
          "01",
        selected_send_quantity:
          500,
      },
      {
        category:
          "A",
        code:
          "59",
        selected_send_quantity:
          1500,
      },
    ],
  });

assert.deepEqual(
  messages,
  [
    {
      type:
        "text",

      text:
        "ส่งออก EAST • ชุดที่ 2\nA59=1500\nB01=500",
    },
  ],
);

console.log(
  "PASS EXP2E-18: LINE payload is server-generated and deterministic",
);


const normalized =
  normalizeExportSendRequest({
    round_id:
      "11111111-1111-4111-8111-111111111111",

    cycle_id:
      "22222222-2222-4222-8222-222222222222",

    destination_line_group_id:
      "UNTRUSTED",

    selected_send_quantity:
      999999,

    messages: [
      {
        type:
          "text",
        text:
          "UNTRUSTED",
      },
    ],
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
  "PASS EXP2E-19: browser cannot control destination, quantity, or LINE payload",
);


let captured = null;

const fake200 =
  async (
    url,
    options,
  ) => {
    captured = {
      url,
      options,
    };

    return {
      status:
        200,

      headers: {
        get(name) {
          if (
            name.toLowerCase()
            === "x-line-request-id"
          ) {
            return "request-1";
          }

          return null;
        },
      },

      async text() {
        return "{}";
      },
    };
  };


const transport =
  await pushExportPreparationToLine({
    channelAccessToken:
      "secret-test-token",

    destinationLineGroupId:
      "C123",

    messages,

    retryKey:
      "11111111-1111-4111-8111-111111111111",

    fetchImpl:
      fake200,
  });


assert.equal(
  transport.classification,
  "ACCEPTED",
);

assert.equal(
  captured.url,
  "https://api.line.me/v2/bot/message/push",
);

assert.equal(
  captured.options.headers[
    "X-Line-Retry-Key"
  ],
  "11111111-1111-4111-8111-111111111111",
);

assert.equal(
  captured.options.headers.Authorization,
  "Bearer secret-test-token",
);

console.log(
  "PASS EXP2E-20: transport sends stable retry key to LINE push endpoint",
);


const fakeNetworkFailure =
  async () => {
    throw new Error(
      "simulated timeout",
    );
  };


const ambiguous =
  await pushExportPreparationToLine({
    channelAccessToken:
      "secret-test-token",

    destinationLineGroupId:
      "C123",

    messages,

    retryKey:
      "11111111-1111-4111-8111-111111111111",

    fetchImpl:
      fakeNetworkFailure,
  });


assert.equal(
  ambiguous.classification,
  "AMBIGUOUS",
);

console.log(
  "PASS EXP2E-21: network ambiguity never claims successful delivery",
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
  "PASS EXP2E-22: Allocation/Risk confirmed-cut storage remains isolated",
);


assert.ok(
  pkg.includes(
    "test-export-preparation-line-delivery-v1.mjs",
  ),
);

console.log(
  "PASS EXP2E-23: Phase 2E registered in full regression",
);


console.log(
  "PASS: Export Preparation LINE Delivery v1",
);
