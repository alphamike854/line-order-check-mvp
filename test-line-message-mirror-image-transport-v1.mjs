"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  classifyLineMirrorImagePreparationError,
  runLineMirrorDestinationWorker,
} from "./src/lib/line-message-mirror-transport.mjs";

import {
  sha256MirrorValue,
} from "./src/lib/line-message-mirror-image.mjs";

function makeSupabase(
  script,
  events = [],
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

      let source =
        script[name];

      if (source === undefined) {
        throw new Error(
          `UNEXPECTED_RPC:${name}`,
        );
      }

      if (
        Array.isArray(
          source,
        )
      ) {
        if (
          source.length === 0
        ) {
          throw new Error(
            `RPC_SCRIPT_EXHAUSTED:${name}`,
          );
        }

        source =
          source.shift();
      }

      if (
        typeof source
          === "function"
      ) {
        source =
          await source(
            args,
            calls,
            events,
          );
      }

      if (
        source?.__error
      ) {
        return {
          data: null,
          error: {
            message:
              source.__error,
          },
        };
      }

      return {
        data:
          source,
        error: null,
      };
    },
  };
}

const logger = {
  error() {},
  log() {},
};

function mixedClaim() {
  return {
    state:
      "CLAIMED",
    batch_id:
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    retry_key:
      "11111111-2222-4333-8444-555555555555",
    items: [
      {
        id:
          101,
        source_message_id:
          "LINE_TEXT_1",
        message_type:
          "text",
        text_payload:
          "01=20",
        event_timestamp:
          "2026-09-14T01:00:00.000Z",
      },
      {
        id:
          102,
        source_message_id:
          "LINE_IMAGE_1",
        message_type:
          "image",
        text_payload:
          null,
        event_timestamp:
          "2026-09-14T01:00:01.000Z",
      },
      {
        id:
          103,
        source_message_id:
          "LINE_TEXT_2",
        message_type:
          "text",
        text_payload:
          "123=10",
        event_timestamp:
          "2026-09-14T01:00:02.000Z",
      },
    ],
  };
}

{
  const events = [];

  let frozenBody =
    null;

  const supabase =
    makeSupabase(
      {
        claim_line_message_mirror_destination_batch:
          [
            mixedClaim(),
            {
              state:
                "EMPTY",
            },
          ],

        get_line_message_mirror_prepared_request:
          () => {
            events.push(
              "recover",
            );

            return {
              ok: false,
              reason:
                "REQUEST_NOT_PREPARED",
            };
          },

        renew_line_message_mirror_destination_worker:
          true,

        prepare_line_message_mirror_batch_request:
          (args) => {
            events.push(
              "freeze",
            );

            frozenBody =
              args.p_request_body;

            assert.equal(
              args.p_request_sha256,
              sha256MirrorValue(
                args.p_request_body,
              ),
            );

            return {
              ok: true,
              already_prepared:
                false,
              batch_id:
                args.p_batch_id,
              request_body:
                args.p_request_body,
              request_sha256:
                args.p_request_sha256,
              prepared_at:
                "2026-09-14T01:00:03.000Z",
            };
          },

        begin_line_message_mirror_batch_attempt:
          () => {
            events.push(
              "begin",
            );

            return {
              ok: true,
            };
          },

        complete_line_message_mirror_batch:
          true,

        release_line_message_mirror_destination_worker:
          true,
      },
      events,
    );

  let imagePreparationArgs =
    null;

  let pushedBody =
    null;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "22222222-2222-4222-8222-222222222222",

      lineChannelAccessToken:
        "channel-token",

      destinationBaseUrl:
        "https://example.netlify.app",

      prepareImageItem:
        async (args) => {
          events.push(
            "image-prepare",
          );

          imagePreparationArgs =
            args;

          return {
            assetId:
              "123e4567-e89b-42d3-a456-426614174000",

            message: {
              type:
                "image",

              originalContentUrl:
                "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=original&token=token",

              previewImageUrl:
                "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=preview&token=token",
            },
          };
        },

      imageFetchImpl:
        async () => {
          throw new Error(
            "IMAGE_FETCH_SHOULD_BE_OWNED_BY_STUB",
          );
        },

      retryDelaysMs:
        [],

      logger,

      fetchImpl:
        async (
          url,
          options,
        ) => {
          events.push(
            "push",
          );

          assert.equal(
            url,
            "https://api.line.me/v2/bot/message/push",
          );

          pushedBody =
            options.body;

          return new Response(
            "{}",
            {
              status:
                200,

              headers: {
                "x-line-request-id":
                  "mixed-request",
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
    imagePreparationArgs.queueId,
    102,
  );

  assert.equal(
    imagePreparationArgs.sourceMessageId,
    "LINE_IMAGE_1",
  );

  assert.equal(
    imagePreparationArgs.destinationBaseUrl,
    "https://example.netlify.app",
  );

  assert.equal(
    pushedBody,
    frozenBody,
  );

  const payload =
    JSON.parse(
      frozenBody,
    );

  assert.equal(
    payload.to,
    "DEST",
  );

  assert.deepEqual(
    payload.messages.map(
      (message) =>
        message.type,
    ),
    [
      "text",
      "image",
      "text",
    ],
  );

  assert.equal(
    payload.messages[0].text,
    "01=20",
  );

  assert.equal(
    payload.messages[2].text,
    "123=10",
  );

  assert.ok(
    events.indexOf(
      "recover",
    )
    <
    events.indexOf(
      "image-prepare",
    ),
  );

  assert.ok(
    events.indexOf(
      "image-prepare",
    )
    <
    events.indexOf(
      "freeze",
    ),
  );

  assert.ok(
    events.indexOf(
      "freeze",
    )
    <
    events.indexOf(
      "begin",
    ),
  );

  assert.ok(
    events.indexOf(
      "begin",
    )
    <
    events.indexOf(
      "push",
    ),
  );

  console.log(
    "PASS MIR2C-D-C2B-01: mixed text/image order is preserved and body freezes before LINE attempt",
  );
}

{
  const persistedBody =
    JSON.stringify({
      to:
        "DEST",

      messages: [
        {
          type:
            "image",

          originalContentUrl:
            "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=original&token=persisted",

          previewImageUrl:
            "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=preview&token=persisted",
        },
      ],
    });

  const retryKey =
    "33333333-3333-4333-8333-333333333333";

  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          {
            state:
              "EXISTING",

            batch_id:
              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",

            retry_key:
              retryKey,

            items: [
              {
                id:
                  201,

                source_message_id:
                  "LINE_IMAGE_RECOVERED",

                message_type:
                  "image",

                text_payload:
                  null,

                event_timestamp:
                  "2026-09-14T02:00:00.000Z",
              },
            ],
          },

          {
            state:
              "EMPTY",
          },
        ],

      get_line_message_mirror_prepared_request:
        {
          ok:
            true,

          batch_id:
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",

          request_body:
            persistedBody,

          request_sha256:
            sha256MirrorValue(
              persistedBody,
            ),

          retry_key:
            retryKey,

          prepared_at:
            "2026-09-14T02:00:01.000Z",
        },

      renew_line_message_mirror_destination_worker:
        true,

      begin_line_message_mirror_batch_attempt:
        {
          ok:
            true,
        },

      complete_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  let prepareImageCalls =
    0;

  let networkCalls =
    0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "44444444-4444-4444-8444-444444444444",

      lineChannelAccessToken:
        "channel-token",

      destinationBaseUrl:
        "",

      prepareImageItem:
        async () => {
          prepareImageCalls +=
            1;

          throw new Error(
            "RECOVERED_BATCH_MUST_NOT_REPREPARE_IMAGE",
          );
        },

      logger,

      retryDelaysMs:
        [],

      fetchImpl:
        async (
          _url,
          options,
        ) => {
          networkCalls +=
            1;

          assert.equal(
            options.body,
            persistedBody,
          );

          assert.equal(
            options.headers[
              "x-line-retry-key"
            ],
            retryKey,
          );

          return new Response(
            "{}",
            {
              status:
                200,
            },
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    prepareImageCalls,
    0,
  );

  assert.equal(
    networkCalls,
    1,
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "prepare_line_message_mirror_batch_request",
    ),
    false,
  );

  console.log(
    "PASS MIR2C-D-C2B-02: frozen image batch recovers exact body before any image/Storage preparation",
  );
}

{
  const retryKey =
    "55555555-5555-4555-8555-555555555555";

  const persistedBody =
    JSON.stringify({
      to:
        "DEST",
      messages: [
        {
          type:
            "text",
          text:
            "01=20",
        },
      ],
    });

  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        {
          state:
            "EXISTING",

          batch_id:
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",

          retry_key:
            retryKey,

          items: [
            {
              id:
                301,

              source_message_id:
                "LINE_TEXT",

              message_type:
                "text",

              text_payload:
                "01=20",

              event_timestamp:
                "2026-09-14T03:00:00.000Z",
            },
          ],
        },

      get_line_message_mirror_prepared_request:
        {
          ok:
            true,

          batch_id:
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",

          request_body:
            persistedBody,

          request_sha256:
            sha256MirrorValue(
              persistedBody,
            ),

          retry_key:
            "66666666-6666-4666-8666-666666666666",

          prepared_at:
            "2026-09-14T03:00:01.000Z",
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  let networkCalls =
    0;

  await assert.rejects(
    () =>
      runLineMirrorDestinationWorker({
        supabase,

        destinationLineGroupId:
          "DEST",

        leaseToken:
          "77777777-7777-4777-8777-777777777777",

        lineChannelAccessToken:
          "channel-token",

        logger,

        fetchImpl:
          async () => {
            networkCalls +=
              1;

            throw new Error(
              "SHOULD_NOT_SEND",
            );
          },
      }),

    /MIRROR_PREPARED_RETRY_KEY_MISMATCH/,
  );

  assert.equal(
    networkCalls,
    0,
  );

  console.log(
    "PASS MIR2C-D-C2B-03: recovered retry-key mismatch fails closed before LINE network I/O",
  );
}

{
  const background =
    fs.readFileSync(
      "./netlify/functions/line-message-mirror-background.mjs",
      "utf8",
    );

  assert.match(
    background,
    /destinationBaseUrl:\s*env\.URL/s,
  );

  console.log(
    "PASS MIR2C-D-C2B-04: background worker forwards canonical Netlify URL",
  );
}

{
  const transport =
    fs.readFileSync(
      "./src/lib/line-message-mirror-transport.mjs",
      "utf8",
    );

  const recoverIndex =
    transport.indexOf(
      `"get_line_message_mirror_prepared_request"`,
    );

  const imageIndex =
    transport.indexOf(
      "await prepareImageItem({",
    );

  const freezeIndex =
    transport.indexOf(
      `"prepare_line_message_mirror_batch_request"`,
    );

  const beginIndex =
    transport.indexOf(
      `"begin_line_message_mirror_batch_attempt"`,
    );

  if (
    recoverIndex < 0
    || imageIndex < 0
    || freezeIndex < 0
    || beginIndex < 0
  ) {
    throw new Error(
      "PREPARED_BODY_STATIC_BOUNDARY_MISSING",
    );
  }

  assert.ok(
    recoverIndex
    <
    imageIndex,
  );

  assert.ok(
    imageIndex
    <
    freezeIndex,
  );

  assert.ok(
    freezeIndex
    <
    beginIndex,
  );

  console.log(
    "PASS MIR2C-D-C2B-05: source order is recover -> image prepare -> freeze -> begin attempt",
  );
}

console.log(
  "PASS: LINE Mirror prepared image transport integration v1",
);


{
  assert.equal(
    classifyLineMirrorImagePreparationError(
      new Error(
        "MIRROR_IMAGE_PREVIEW_TOO_LARGE:1048577",
      ),
    ),
    "PERMANENT",
  );

  assert.equal(
    classifyLineMirrorImagePreparationError(
      new Error(
        "MIRROR_IMAGE_ORIGINAL_DOWNLOAD_FAILED_404:not found",
      ),
    ),
    "PERMANENT",
  );

  assert.equal(
    classifyLineMirrorImagePreparationError(
      new Error(
        "MIRROR_IMAGE_ORIGINAL_DOWNLOAD_FAILED_500:temporary",
      ),
    ),
    "RETRYABLE",
  );

  assert.equal(
    classifyLineMirrorImagePreparationError(
      new Error(
        "MIRROR_IMAGE_STORAGE_UPLOAD_FAILED:timeout",
      ),
    ),
    "RETRYABLE",
  );

  assert.equal(
    classifyLineMirrorImagePreparationError(
      new Error(
        "MIRROR_IMAGE_READY_TRANSITION_REJECTED",
      ),
    ),
    "LEASE",
  );

  console.log(
    "PASS MIR2C-D-C2C-01: image preparation failures classify as permanent/retryable/lease",
  );
}

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          {
            state:
              "CLAIMED",
            batch_id:
              "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            retry_key:
              "88888888-8888-4888-8888-888888888888",
            items: [
              {
                id:
                  401,
                source_message_id:
                  "LINE_BAD_IMAGE",
                message_type:
                  "image",
                text_payload:
                  null,
                event_timestamp:
                  "2026-09-14T04:00:00.000Z",
              },
            ],
          },
          {
            state:
              "EMPTY",
          },
        ],

      get_line_message_mirror_prepared_request:
        {
          ok:
            false,
          reason:
            "REQUEST_NOT_PREPARED",
        },

      renew_line_message_mirror_destination_worker:
        true,

      cancel_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  let networkCalls =
    0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "99999999-9999-4999-8999-999999999999",

      lineChannelAccessToken:
        "channel-token",

      destinationBaseUrl:
        "https://example.netlify.app",

      prepareImageItem:
        async () => {
          throw new Error(
            "MIRROR_IMAGE_PREVIEW_TOO_LARGE:1048577",
          );
        },

      logger,

      fetchImpl:
        async () => {
          networkCalls +=
            1;

          throw new Error(
            "PERMANENT_IMAGE_MUST_NOT_PUSH",
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    networkCalls,
    0,
  );

  const cancelled =
    supabase.calls.find(
      (call) =>
        call.name
        === "cancel_line_message_mirror_batch",
    );

  assert.ok(
    cancelled,
  );

  assert.match(
    cancelled.args.p_reason,
    /LINE_IMAGE_PREPARATION_PERMANENT/,
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "begin_line_message_mirror_batch_attempt",
    ),
    false,
  );

  console.log(
    "PASS MIR2C-D-C2C-02: permanent image failure cancels whole batch before LINE attempt",
  );
}

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        {
          state:
            "CLAIMED",
          batch_id:
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          retry_key:
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          items: [
            {
              id:
                501,
              source_message_id:
                "LINE_TEMP_IMAGE",
              message_type:
                "image",
              text_payload:
                null,
              event_timestamp:
                "2026-09-14T05:00:00.000Z",
            },
          ],
        },

      get_line_message_mirror_prepared_request:
        {
          ok:
            false,
          reason:
            "REQUEST_NOT_PREPARED",
        },

      renew_line_message_mirror_destination_worker:
        [
          true,
          true,
          true,
        ],

      fail_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  let networkCalls =
    0;

  await assert.rejects(
    () =>
      runLineMirrorDestinationWorker({
        supabase,

        destinationLineGroupId:
          "DEST",

        leaseToken:
          "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",

        lineChannelAccessToken:
          "channel-token",

        destinationBaseUrl:
          "https://example.netlify.app",

        prepareImageItem:
          async () => {
            throw new Error(
              "MIRROR_IMAGE_ORIGINAL_DOWNLOAD_FAILED_500:temporary",
            );
          },

        logger,

        retryDelaysMs:
          [],

        fetchImpl:
          async () => {
            networkCalls +=
              1;

            throw new Error(
              "TRANSIENT_IMAGE_MUST_NOT_PUSH",
            );
          },
      }),

    /LINE_MIRROR_IMAGE_PREPARATION_RETRYABLE_EXHAUSTED/,
  );

  assert.equal(
    networkCalls,
    0,
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "fail_line_message_mirror_batch",
    ),
    true,
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "cancel_line_message_mirror_batch",
    ),
    false,
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

  console.log(
    "PASS MIR2C-D-C2C-03: transient image failure remains retryable and retains retry lease",
  );
}

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        {
          state:
            "CLAIMED",
          batch_id:
            "ffffffff-ffff-4fff-8fff-ffffffffffff",
          retry_key:
            "12121212-1212-4212-8212-121212121212",
          items: [
            {
              id:
                601,
              source_message_id:
                "LINE_LEASE_IMAGE",
              message_type:
                "image",
              text_payload:
                null,
              event_timestamp:
                "2026-09-14T06:00:00.000Z",
            },
          ],
        },

      get_line_message_mirror_prepared_request:
        {
          ok:
            false,
          reason:
            "REQUEST_NOT_PREPARED",
        },

      renew_line_message_mirror_destination_worker:
        [
          true,
          false,
        ],

      reserve_line_message_mirror_destination_worker:
        {
          reserved:
            false,
          reason:
            "LEASE_HELD",
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  let networkCalls =
    0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "13131313-1313-4313-8313-131313131313",

      lineChannelAccessToken:
        "channel-token",

      destinationBaseUrl:
        "https://example.netlify.app",

      prepareImageItem:
        async () => {
          throw new Error(
            "MIRROR_IMAGE_READY_TRANSITION_REJECTED",
          );
        },

      logger,

      fetchImpl:
        async () => {
          networkCalls +=
            1;

          throw new Error(
            "LEASE_LOST_MUST_NOT_PUSH",
          );
        },
    });

  assert.equal(
    result.status,
    "LEASE_LOST",
  );

  assert.equal(
    networkCalls,
    0,
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "fail_line_message_mirror_batch",
    ),
    false,
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "cancel_line_message_mirror_batch",
    ),
    false,
  );

  console.log(
    "PASS MIR2C-D-C2C-04: lease loss during image preparation performs no stale state mutation",
  );
}

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          {
            state:
              "CLAIMED",
            batch_id:
              "14141414-1414-4414-8414-141414141414",
            retry_key:
              "15151515-1515-4515-8515-151515151515",
            items: [
              {
                id:
                  701,
                source_message_id:
                  "LINE_REACQUIRE_IMAGE",
                message_type:
                  "image",
                text_payload:
                  null,
                event_timestamp:
                  "2026-09-14T07:00:00.000Z",
              },
            ],
          },
          {
            state:
              "EMPTY",
          },
        ],

      get_line_message_mirror_prepared_request:
        {
          ok:
            false,
          reason:
            "REQUEST_NOT_PREPARED",
        },

      renew_line_message_mirror_destination_worker:
        [
          true,
          false,
          true,
          true,
        ],

      reserve_line_message_mirror_destination_worker:
        {
          reserved:
            true,
          lease_token:
            "16161616-1616-4616-8616-161616161616",
        },

      prepare_line_message_mirror_batch_request:
        (args) => ({
          ok:
            true,
          already_prepared:
            false,
          batch_id:
            args.p_batch_id,
          request_body:
            args.p_request_body,
          request_sha256:
            args.p_request_sha256,
          prepared_at:
            "2026-09-14T07:00:02.000Z",
        }),

      begin_line_message_mirror_batch_attempt:
        {
          ok:
            true,
        },

      complete_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  let preparationCalls =
    0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "17171717-1717-4717-8717-171717171717",

      lineChannelAccessToken:
        "channel-token",

      destinationBaseUrl:
        "https://example.netlify.app",

      prepareImageItem:
        async (args) => {
          preparationCalls +=
            1;

          if (
            preparationCalls === 1
          ) {
            throw new Error(
              "MIRROR_IMAGE_READY_TRANSITION_REJECTED",
            );
          }

          assert.equal(
            args.leaseToken,
            "16161616-1616-4616-8616-161616161616",
          );

          return {
            message: {
              type:
                "image",
              originalContentUrl:
                "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=original&token=recovered",
              previewImageUrl:
                "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=preview&token=recovered",
            },
          };
        },

      logger,

      retryDelaysMs:
        [],

      fetchImpl:
        async () =>
          new Response(
            "{}",
            {
              status:
                200,
            },
          ),
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    preparationCalls,
    2,
  );

  console.log(
    "PASS MIR2C-D-C2C-05: expired lease can be reacquired and image preparation retried once safely",
  );
}

{
  let firstPushCalls =
    0;

  const firstSupabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        {
          state:
            "CLAIMED",
          batch_id:
            "18181818-1818-4818-8818-181818181818",
          retry_key:
            "19191919-1919-4919-8919-191919191919",
          items: [
            {
              id:
                801,
              source_message_id:
                "LINE_CRASH_WINDOW",
              message_type:
                "image",
              text_payload:
                null,
              event_timestamp:
                "2026-09-14T08:00:00.000Z",
            },
          ],
        },

      get_line_message_mirror_prepared_request:
        {
          ok:
            false,
          reason:
            "REQUEST_NOT_PREPARED",
        },

      renew_line_message_mirror_destination_worker:
        [
          true,
          true,
        ],

      prepare_line_message_mirror_batch_request:
        {
          __error:
            "SIMULATED_FREEZE_DB_OUTAGE",
        },

      release_line_message_mirror_destination_worker:
        true,
    });

  await assert.rejects(
    () =>
      runLineMirrorDestinationWorker({
        supabase:
          firstSupabase,

        destinationLineGroupId:
          "DEST",

        leaseToken:
          "20202020-2020-4020-8020-202020202020",

        lineChannelAccessToken:
          "channel-token",

        destinationBaseUrl:
          "https://example.netlify.app",

        prepareImageItem:
          async () => ({
            message: {
              type:
                "image",
              originalContentUrl:
                "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=original&token=first",
              previewImageUrl:
                "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=preview&token=first",
            },
          }),

        logger,

        fetchImpl:
          async () => {
            firstPushCalls +=
              1;

            throw new Error(
              "FREEZE_FAILURE_MUST_NOT_PUSH",
            );
          },
      }),

    /SIMULATED_FREEZE_DB_OUTAGE/,
  );

  assert.equal(
    firstPushCalls,
    0,
  );

  const secondSupabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          {
            state:
              "EXISTING",
            batch_id:
              "18181818-1818-4818-8818-181818181818",
            retry_key:
              "19191919-1919-4919-8919-191919191919",
            items: [
              {
                id:
                  801,
                source_message_id:
                  "LINE_CRASH_WINDOW",
                message_type:
                  "image",
                text_payload:
                  null,
                event_timestamp:
                  "2026-09-14T08:00:00.000Z",
              },
            ],
          },
          {
            state:
              "EMPTY",
          },
        ],

      get_line_message_mirror_prepared_request:
        {
          ok:
            false,
          reason:
            "REQUEST_NOT_PREPARED",
        },

      renew_line_message_mirror_destination_worker:
        [
          true,
          true,
          true,
        ],

      prepare_line_message_mirror_batch_request:
        (args) => ({
          ok:
            true,
          already_prepared:
            false,
          batch_id:
            args.p_batch_id,
          request_body:
            args.p_request_body,
          request_sha256:
            args.p_request_sha256,
          prepared_at:
            "2026-09-14T08:00:05.000Z",
        }),

      begin_line_message_mirror_batch_attempt:
        {
          ok:
            true,
        },

      complete_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  let secondPrepareCalls =
    0;

  let secondPushCalls =
    0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase:
        secondSupabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "21212121-2121-4121-8121-212121212121",

      lineChannelAccessToken:
        "channel-token",

      destinationBaseUrl:
        "https://example.netlify.app",

      prepareImageItem:
        async () => {
          secondPrepareCalls +=
            1;

          return {
            message: {
              type:
                "image",
              originalContentUrl:
                "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=original&token=refreshed",
              previewImageUrl:
                "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=preview&token=refreshed",
            },
          };
        },

      logger,

      retryDelaysMs:
        [],

      fetchImpl:
        async () => {
          secondPushCalls +=
            1;

          return new Response(
            "{}",
            {
              status:
                200,
            },
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    secondPrepareCalls,
    1,
  );

  assert.equal(
    secondPushCalls,
    1,
  );

  console.log(
    "PASS MIR2C-D-C2C-06: crash after image preparation but before request freeze is recoverable without premature Push",
  );
}

console.log(
  "PASS: LINE Mirror image failure/crash hardening v1",
);

{
  const events = [];

  const supabase =
    makeSupabase(
      {
        claim_line_message_mirror_destination_batch:
          [
            {
              state:
                "CLAIMED",
              batch_id:
                "22222222-aaaa-4bbb-8ccc-222222222222",
              retry_key:
                "23232323-2323-4323-8323-232323232323",
              items: [
                {
                  id:
                    1001,
                  source_message_id:
                    "LINE_GOOD_IMAGE",
                  message_type:
                    "image",
                  text_payload:
                    null,
                  event_timestamp:
                    "2026-09-14T09:00:00.000Z",
                },
                {
                  id:
                    1002,
                  source_message_id:
                    "LINE_BAD_IMAGE",
                  message_type:
                    "image",
                  text_payload:
                    null,
                  event_timestamp:
                    "2026-09-14T09:00:01.000Z",
                },
              ],
            },
            {
              state:
                "EMPTY",
            },
          ],

        get_line_message_mirror_prepared_request:
          {
            ok:
              false,
            reason:
              "REQUEST_NOT_PREPARED",
          },

        renew_line_message_mirror_destination_worker:
          [
            true,
            true,
            true,
            true,
          ],

        cancel_line_message_mirror_batch:
          () => {
            events.push(
              "cancel",
            );

            return true;
          },

        release_line_message_mirror_destination_worker:
          true,
      },
      events,
    );

  let prepareCalls =
    0;

  let cleanupArgs =
    null;

  let networkCalls =
    0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "24242424-2424-4424-8424-242424242424",

      lineChannelAccessToken:
        "channel-token",

      destinationBaseUrl:
        "https://example.netlify.app",

      prepareImageItem:
        async () => {
          prepareCalls +=
            1;

          if (
            prepareCalls === 1
          ) {
            return {
              message: {
                type:
                  "image",
                originalContentUrl:
                  "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=original&token=first",
                previewImageUrl:
                  "https://example.netlify.app/api/line-message-mirror-image?asset=123e4567-e89b-42d3-a456-426614174000&kind=preview&token=first",
              },
            };
          }

          throw new Error(
            "MIRROR_IMAGE_PREVIEW_TOO_LARGE:1048577",
          );
        },

      cleanupImageItems:
        async (args) => {
          events.push(
            "cleanup",
          );

          cleanupArgs =
            args;

          return {
            ok:
              true,
            assetCount:
              2,
            objectCount:
              4,
          };
        },

      logger,

      fetchImpl:
        async () => {
          networkCalls +=
            1;

          throw new Error(
            "TERMINAL_MIXED_IMAGE_BATCH_MUST_NOT_PUSH",
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    prepareCalls,
    2,
  );

  assert.equal(
    networkCalls,
    0,
  );

  assert.deepEqual(
    cleanupArgs.queueIds,
    [
      1001,
      1002,
    ],
  );

  assert.ok(
    events.indexOf(
      "cancel",
    )
    <
    events.indexOf(
      "cleanup",
    ),
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "begin_line_message_mirror_batch_attempt",
    ),
    false,
  );

  console.log(
    "PASS MIR2C-D-C2D-03: permanent mixed-image failure cancels before cleanup and never Pushes partial batch",
  );
}

{
  const supabase =
    makeSupabase({
      claim_line_message_mirror_destination_batch:
        [
          {
            state:
              "CLAIMED",
            batch_id:
              "25252525-2525-4525-8525-252525252525",
            retry_key:
              "26262626-2626-4626-8626-262626262626",
            items: [
              {
                id:
                  1101,
                source_message_id:
                  "LINE_TERMINAL_IMAGE",
                message_type:
                  "image",
                text_payload:
                  null,
                event_timestamp:
                  "2026-09-14T10:00:00.000Z",
              },
            ],
          },
          {
            state:
              "EMPTY",
          },
        ],

      get_line_message_mirror_prepared_request:
        {
          ok:
            false,
          reason:
            "REQUEST_NOT_PREPARED",
        },

      renew_line_message_mirror_destination_worker:
        [
          true,
          true,
        ],

      cancel_line_message_mirror_batch:
        true,

      release_line_message_mirror_destination_worker:
        true,
    });

  let cleanupCalls =
    0;

  const result =
    await runLineMirrorDestinationWorker({
      supabase,

      destinationLineGroupId:
        "DEST",

      leaseToken:
        "27272727-2727-4727-8727-272727272727",

      lineChannelAccessToken:
        "channel-token",

      destinationBaseUrl:
        "https://example.netlify.app",

      prepareImageItem:
        async () => {
          throw new Error(
            "MIRROR_IMAGE_ORIGINAL_DOWNLOAD_FAILED_404:not found",
          );
        },

      cleanupImageItems:
        async () => {
          cleanupCalls +=
            1;

          throw new Error(
            "SIMULATED_CLEANUP_FAILURE",
          );
        },

      logger: {
        error() {},
        log() {},
      },

      fetchImpl:
        async () => {
          throw new Error(
            "MUST_NOT_PUSH",
          );
        },
    });

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    cleanupCalls,
    1,
  );

  assert.equal(
    supabase.calls.some(
      (call) =>
        call.name
        === "cancel_line_message_mirror_batch",
    ),
    true,
  );

  console.log(
    "PASS MIR2C-D-C2D-04: cleanup failure cannot roll back terminal batch cancellation",
  );
}

console.log(
  "PASS: LINE Mirror terminal cleanup transport integration v1",
);
