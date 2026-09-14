"use strict";

import assert from "node:assert/strict";

import {
  buildLineMirrorTextPayload,
  classifyLineMirrorPushStatus,
  getLineMirrorRequestId,
  LINE_MIRROR_WAKE_TIMEOUT_MS,
  normalizeMirrorDestinations,
  runLineMirrorDestinationWorker,
  safeMirrorSecretEqual,
  wakeLineMirrorDestinationBestEffort,
} from "./src/lib/line-message-mirror-transport.mjs";


function makeSupabase(
  script,
) {
  const calls = [];

  return {
    calls,

    async rpc(
      name,
      args,
    ) {
      calls.push({
        name,
        args,
      });

      const source =
        script[name];

      if (
        source === undefined
      ) {
        throw new Error(
          `UNEXPECTED_RPC:${name}`,
        );
      }

      let value;

      if (
        Array.isArray(source)
      ) {
        if (
          source.length === 0
        ) {
          throw new Error(
            `RPC_SCRIPT_EXHAUSTED:${name}`,
          );
        }

        value =
          source.shift();
      } else {
        value =
          source;
      }

      if (
        typeof value
        === "function"
      ) {
        value =
          await value(
            args,
            calls,
          );
      }

      if (
        value
        && value.__error
      ) {
        return {
          data: null,
          error: {
            message:
              value.__error,
          },
        };
      }

      return {
        data: value,
        error: null,
      };
    },
  };
}


const logger = {
  error() {},
  log() {},
};


// ------------------------------------------------------------
// Secret comparison.
// ------------------------------------------------------------

assert.equal(
  safeMirrorSecretEqual(
    "abc",
    "abc",
  ),
  true,
);

assert.equal(
  safeMirrorSecretEqual(
    "abc",
    "abd",
  ),
  false,
);

assert.equal(
  safeMirrorSecretEqual(
    "",
    "",
  ),
  false,
);

console.log(
  "PASS MIR2C-C-B1-01: worker secret comparison is constant-time bounded",
);


// ------------------------------------------------------------
// Destination normalization.
// ------------------------------------------------------------

assert.deepEqual(
  normalizeMirrorDestinations({
    destinations: [
      "G1",
      " G2 ",
      "G1",
      "",
      null,
    ],
  }),
  [
    "G1",
    "G2",
  ],
);

console.log(
  "PASS MIR2C-C-B1-02: enqueue destinations are deduplicated",
);


// ------------------------------------------------------------
// LINE text payload.
// ------------------------------------------------------------

const payload =
  buildLineMirrorTextPayload(
    "DEST",
    [
      {
        message_type:
          "text",
        text_payload:
          "01=20",
      },
      {
        message_type:
          "text",
        text_payload:
          "123=10",
      },
    ],
  );

assert.deepEqual(
  payload,
  {
    to: "DEST",
    messages: [
      {
        type: "text",
        text: "01=20",
      },
      {
        type: "text",
        text: "123=10",
      },
    ],
  },
);

assert.throws(
  () =>
    buildLineMirrorTextPayload(
      "DEST",
      Array.from(
        {
          length: 6,
        },
        () => ({
          message_type:
            "text",
          text_payload:
            "x",
        }),
      ),
    ),
  /MIRROR_BATCH_ITEM_COUNT_INVALID/,
);

assert.throws(
  () =>
    buildLineMirrorTextPayload(
      "DEST",
      [{
        message_type:
          "image",
        text_payload:
          null,
      }],
    ),
  /MIR2C_C_TEXT_ONLY_BATCH/,
);

console.log(
  "PASS MIR2C-C-B1-03: Push payload preserves raw text and hard-caps at five",
);


// ------------------------------------------------------------
// LINE response semantics.
// ------------------------------------------------------------

assert.equal(
  classifyLineMirrorPushStatus(
    200,
  ),
  "ACCEPTED",
);

assert.equal(
  classifyLineMirrorPushStatus(
    409,
  ),
  "ALREADY_ACCEPTED",
);

assert.equal(
  classifyLineMirrorPushStatus(
    500,
  ),
  "RETRYABLE",
);

assert.equal(
  classifyLineMirrorPushStatus(
    400,
  ),
  "PERMANENT",
);

const accepted409 =
  new Response(
    JSON.stringify({
      message:
        "already accepted",
    }),
    {
      status: 409,
      headers: {
        "x-line-request-id":
          "retry-request",

        "x-line-accepted-request-id":
          "accepted-request",
      },
    },
  );

assert.equal(
  getLineMirrorRequestId(
    accepted409,
    409,
  ),
  "accepted-request",
);

console.log(
  "PASS MIR2C-C-B1-04: 2xx/409/5xx/4xx classification matches retry contract",
);


// ------------------------------------------------------------
// Wake worker: reserve -> HTTP 202.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      reserve_line_message_mirror_destination_worker:
        {
          reserved: true,
          lease_token:
            "lease-1",
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  const fetchCalls = [];

  const result =
    await wakeLineMirrorDestinationBestEffort({
      supabase,

      destinationLineGroupId:
        "DEST",

      baseUrl:
        "https://example.netlify.app",

      workerSecret:
        "secret",

      logger,

      fetchImpl:
        async (
          url,
          options,
        ) => {
          fetchCalls.push({
            url:
              String(url),
            options,
          });

          return new Response(
            "",
            {
              status: 202,
            },
          );
        },
    });

  assert.equal(
    result.woken,
    true,
  );

  assert.equal(
    fetchCalls.length,
    1,
  );

  assert.equal(
    fetchCalls[0]
      .url,
    "https://example.netlify.app/.netlify/functions/line-message-mirror-background",
  );

  assert.equal(
    fetchCalls[0]
      .options
      .headers[
        "x-line-message-mirror-worker-secret"
      ],
    "secret",
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "release_line_message_mirror_destination_worker",
    ),
    false,
  );
}

console.log(
  "PASS MIR2C-C-B1-05: successful background acceptance retains worker lease",
);


// ------------------------------------------------------------
// Wake failure releases reservation.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      reserve_line_message_mirror_destination_worker:
        {
          reserved: true,
          lease_token:
            "lease-2",
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  const result =
    await wakeLineMirrorDestinationBestEffort({
      supabase,

      destinationLineGroupId:
        "DEST",

      baseUrl:
        "https://example.netlify.app",

      workerSecret:
        "secret",

      logger,

      fetchImpl:
        async () =>
          new Response(
            "not accepted",
            {
              status: 503,
            },
          ),
    });

  assert.equal(
    result.woken,
    false,
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "release_line_message_mirror_destination_worker",
    ),
    true,
  );
}

console.log(
  "PASS MIR2C-C-B1-06: failed background invocation releases reservation",
);


function textClaim({
  batch = "batch-1",
  retry = "11111111-1111-4111-8111-111111111111",
} = {}) {
  return {
    state: "CLAIMED",
    batch_id: batch,
    retry_key: retry,
    items: [{
      id: 1,
      message_type:
        "text",
      text_payload:
        "01=20",
      event_timestamp:
        "2026-09-14T01:00:00Z",
    }],
  };
}


// ------------------------------------------------------------
// Happy path.
// ------------------------------------------------------------

{
  const completeArgs = [];

  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          textClaim(),
          {
            state: "EMPTY",
          },
        ],

      renew_line_message_mirror_destination_worker:
        true,

      begin_line_message_mirror_batch_attempt:
        {
          ok: true,
        },

      complete_line_message_mirror_batch:
        (args) => {
          completeArgs.push(
            args,
          );
          return true;
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  let sent = 0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "lease",

      lineChannelAccessToken:
        "channel-token",

      logger,

      retryDelaysMs: [],

      fetchImpl:
        async (
          url,
          options,
        ) => {
          sent += 1;

          assert.equal(
            url,
            "https://api.line.me/v2/bot/message/push",
          );

          assert.equal(
            options.headers[
              "x-line-retry-key"
            ],
            "11111111-1111-4111-8111-111111111111",
          );

          return new Response(
            "{}",
            {
              status: 200,
              headers: {
                "x-line-request-id":
                  "line-request-1",
              },
            },
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    sent,
    1,
  );

  assert.equal(
    completeArgs[0]
      .p_line_request_id,
    "line-request-1",
  );
}

console.log(
  "PASS MIR2C-C-B1-07: claimed text batch completes and drains destination",
);


// ------------------------------------------------------------
// Retryable 500 reuses exactly the same retry key and body.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          textClaim({
            batch:
              "batch-retry",
            retry:
              "22222222-2222-4222-8222-222222222222",
          }),
          {
            state: "EMPTY",
          },
        ],

      renew_line_message_mirror_destination_worker:
        true,

      begin_line_message_mirror_batch_attempt:
        () => ({
          ok: true,
        }),

      fail_line_message_mirror_batch:
        true,

      complete_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  const requests = [];

  let attempt = 0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "lease",

      lineChannelAccessToken:
        "channel-token",

      logger,

      retryDelaysMs: [
        0,
      ],

      sleepImpl:
        async () => {},

      fetchImpl:
        async (
          _url,
          options,
        ) => {
          requests.push({
            body:
              options.body,

            retryKey:
              options.headers[
                "x-line-retry-key"
              ],
          });

          attempt += 1;

          if (attempt === 1) {
            return new Response(
              "temporary",
              {
                status: 500,
              },
            );
          }

          return new Response(
            "{}",
            {
              status: 200,
              headers: {
                "x-line-request-id":
                  "retry-success",
              },
            },
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    requests.length,
    2,
  );

  assert.equal(
    requests[0].body,
    requests[1].body,
  );

  assert.equal(
    requests[0].retryKey,
    requests[1].retryKey,
  );
}

console.log(
  "PASS MIR2C-C-B1-08: bounded retry preserves identical recipient/content/retry key",
);


// ------------------------------------------------------------
// HTTP 409 is successful prior acceptance.
// ------------------------------------------------------------

{
  const completeArgs = [];

  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          textClaim({
            batch:
              "batch-409",
          }),
          {
            state: "EMPTY",
          },
        ],

      renew_line_message_mirror_destination_worker:
        true,

      begin_line_message_mirror_batch_attempt:
        {
          ok: true,
        },

      complete_line_message_mirror_batch:
        (args) => {
          completeArgs.push(
            args,
          );
          return true;
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "lease",

      lineChannelAccessToken:
        "channel-token",

      logger,

      retryDelaysMs: [],

      fetchImpl:
        async () =>
          new Response(
            JSON.stringify({
              message:
                "The retry key is already accepted",
            }),
            {
              status: 409,
              headers: {
                "x-line-request-id":
                  "retry-request",

                "x-line-accepted-request-id":
                  "accepted-request",
              },
            },
          ),
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    completeArgs[0]
      .p_line_request_id,
    "accepted-request",
  );
}

console.log(
  "PASS MIR2C-C-B1-09: HTTP 409 completes using accepted request identity",
);


// ------------------------------------------------------------
// Deterministic 4xx is terminal dead-letter.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          textClaim({
            batch:
              "batch-400",
          }),
          {
            state: "EMPTY",
          },
        ],

      renew_line_message_mirror_destination_worker:
        true,

      begin_line_message_mirror_batch_attempt:
        {
          ok: true,
        },

      cancel_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "lease",

      lineChannelAccessToken:
        "channel-token",

      logger,

      retryDelaysMs: [],

      fetchImpl:
        async () =>
          new Response(
            "bad request",
            {
              status: 400,
            },
          ),
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "cancel_line_message_mirror_batch",
    ),
    true,
  );
}

console.log(
  "PASS MIR2C-C-B1-10: deterministic non-retryable 4xx is dead-lettered",
);


// ------------------------------------------------------------
// Image blocks safely in text-only phase.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [{
          state:
            "CLAIMED",

          batch_id:
            "batch-image",

          retry_key:
            "33333333-3333-4333-8333-333333333333",

          items: [{
            id: 2,
            message_type:
              "image",
            text_payload:
              null,
          }],
        }],

      fail_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  let networkCalls = 0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "lease",

      lineChannelAccessToken:
        "channel-token",

      logger,

      fetchImpl:
        async () => {
          networkCalls += 1;
          throw new Error(
            "SHOULD_NOT_SEND",
          );
        },
    });

  assert.equal(
    result.status,
    "BLOCKED_NON_TEXT",
  );

  assert.equal(
    networkCalls,
    0,
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "cancel_line_message_mirror_batch",
    ),
    false,
  );
}

console.log(
  "PASS MIR2C-C-B1-11: image is never sent or dead-lettered by text-only worker",
);


// ------------------------------------------------------------
// WAIT sleeps and renews the destination lease.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          {
            state: "WAIT",
            wait_ms: 1,
          },
          {
            state: "EMPTY",
          },
        ],

      renew_line_message_mirror_destination_worker:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  const sleeps = [];

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "lease",

      lineChannelAccessToken:
        "channel-token",

      logger,

      sleepImpl:
        async (ms) => {
          sleeps.push(ms);
        },

      fetchImpl:
        async () => {
          throw new Error(
            "SHOULD_NOT_SEND",
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.deepEqual(
    sleeps,
    [
      1,
    ],
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "renew_line_message_mirror_destination_worker",
    ),
    true,
  );
}

console.log(
  "PASS MIR2C-C-B1-12: WAIT preserves serialization by renewing lease",
);



// ------------------------------------------------------------
// R2: internal background wake is bounded independently from
// LINE Push transport timeout.
// ------------------------------------------------------------

assert.equal(
  LINE_MIRROR_WAKE_TIMEOUT_MS,
  3000,
);

{
  const supabase =
    makeSupabase({
      reserve_line_message_mirror_destination_worker:
        {
          reserved: true,
          lease_token:
            "lease-wake-timeout",
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  let observedSignal =
    null;

  const result =
    await wakeLineMirrorDestinationBestEffort({
      supabase,

      destinationLineGroupId:
        "DEST",

      baseUrl:
        "https://example.netlify.app",

      workerSecret:
        "secret",

      logger,

      fetchImpl:
        async (
          _url,
          options,
        ) => {
          observedSignal =
            options.signal;

          return new Response(
            "",
            {
              status: 202,
            },
          );
        },
    });

  assert.equal(
    result.woken,
    true,
  );

  assert.ok(
    observedSignal
      instanceof AbortSignal,
  );
}

console.log(
  "PASS MIR2C-C-B2-R2-01: internal worker wake has independent bounded timeout",
);



// ------------------------------------------------------------
// R3: timeout/network failure is ambiguous.
//
// Netlify may have accepted the background invocation even when
// the caller never receives 202. The reservation must therefore
// remain intact instead of being released underneath that worker.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      reserve_line_message_mirror_destination_worker:
        {
          reserved: true,
          lease_token:
            "lease-ambiguous",
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  const result =
    await wakeLineMirrorDestinationBestEffort({
      supabase,

      destinationLineGroupId:
        "DEST",

      baseUrl:
        "https://example.netlify.app",

      workerSecret:
        "secret",

      logger,

      fetchImpl:
        async () => {
          throw new Error(
            "AMBIGUOUS_NETWORK_FAILURE",
          );
        },
    });

  assert.equal(
    result.woken,
    false,
  );

  assert.equal(
    result.ambiguous,
    true,
  );

  assert.equal(
    result.lease_retained,
    true,
  );

  const releases =
    supabase.calls.filter(
      (call) =>
        call.name
        === "release_line_message_mirror_destination_worker",
    );

  assert.equal(
    releases.length,
    0,
  );
}

console.log(
  "PASS MIR2C-C-B2-R3-01: ambiguous wake failure preserves destination lease",
);

console.log(
  "PASS: LINE Mirror text transport engine v1",
);


// ------------------------------------------------------------
// R1: A 30-second WAIT must not sleep for 30 seconds.
//
// Re-check after <=1 second so that newly-arrived messages can
// make the DB claim return a full batch immediately.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          {
            state:
              "WAIT",
            wait_ms:
              30000,
          },
          {
            state:
              "EMPTY",
          },
        ],

      renew_line_message_mirror_destination_worker:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  const sleeps = [];

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "lease",

      lineChannelAccessToken:
        "channel-token",

      logger,

      sleepImpl:
        async (ms) => {
          sleeps.push(ms);
        },

      fetchImpl:
        async () => {
          throw new Error(
            "SHOULD_NOT_SEND",
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.deepEqual(
    sleeps,
    [
      1000,
    ],
  );

  const claims =
    supabase.calls.filter(
      (call) =>
        call.name
        === "claim_line_message_mirror_destination_batch",
    );

  assert.equal(
    claims.length,
    2,
  );
}

console.log(
  "PASS MIR2C-C-B1-R1-01: WAIT re-checks queue within one second",
);


// ------------------------------------------------------------
// R1: renew lease immediately before LINE network I/O.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          textClaim({
            batch:
              "batch-lease-renew",
            retry:
              "44444444-4444-4444-8444-444444444444",
          }),
          {
            state:
              "EMPTY",
          },
        ],

      renew_line_message_mirror_destination_worker:
        true,

      begin_line_message_mirror_batch_attempt:
        {
          ok: true,
        },

      complete_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  let networkCalls = 0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "lease",

      lineChannelAccessToken:
        "channel-token",

      logger,

      retryDelaysMs: [],

      fetchImpl:
        async () => {
          networkCalls += 1;

          const renewIndex =
            supabase.calls.findIndex(
              (call) =>
                call.name
                === "renew_line_message_mirror_destination_worker",
            );

          const beginIndex =
            supabase.calls.findIndex(
              (call) =>
                call.name
                === "begin_line_message_mirror_batch_attempt",
            );

          assert.ok(
            renewIndex >= 0,
          );

          assert.ok(
            beginIndex > renewIndex,
          );

          return new Response(
            "{}",
            {
              status: 200,
            },
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    networkCalls,
    1,
  );
}

console.log(
  "PASS MIR2C-C-B1-R1-02: lease renews before LINE network attempt",
);


// ------------------------------------------------------------
// R1: if the old lease expired, reacquire before sending.
// ------------------------------------------------------------

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          textClaim({
            batch:
              "batch-reacquire",
            retry:
              "55555555-5555-4555-8555-555555555555",
          }),
          {
            state:
              "EMPTY",
          },
        ],

      renew_line_message_mirror_destination_worker:
        [
          false,
          true,
        ],

      reserve_line_message_mirror_destination_worker:
        {
          reserved: true,
          lease_token:
            "replacement-lease",
        },

      begin_line_message_mirror_batch_attempt:
        (args) => {
          assert.equal(
            args.p_lease_token,
            "replacement-lease",
          );

          return {
            ok: true,
          };
        },

      complete_line_message_mirror_batch:
        (args) => {
          assert.equal(
            args.p_lease_token,
            "replacement-lease",
          );

          return true;
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "expired-lease",

      lineChannelAccessToken:
        "channel-token",

      logger,

      retryDelaysMs: [],

      fetchImpl:
        async () =>
          new Response(
            "{}",
            {
              status: 200,
            },
          ),
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "reserve_line_message_mirror_destination_worker",
    ),
    true,
  );
}

console.log(
  "PASS MIR2C-C-B1-R1-03: expired lease is reacquired before send",
);
