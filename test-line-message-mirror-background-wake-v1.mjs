"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  handleLineMessageMirrorBackground,
} from "./netlify/functions/line-message-mirror-background.mjs";


const webhookSource =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const workerSource =
  fs.readFileSync(
    "netlify/functions/line-message-mirror-background.mjs",
    "utf8",
  );


// ------------------------------------------------------------
// Source integration: global kill switch still precedes enqueue/wake.
// ------------------------------------------------------------

const helperStart =
  webhookSource.indexOf(
    "async function enqueueLineMessageMirrorBestEffort",
  );

const helperEnd =
  webhookSource.indexOf(
    "\nasync function ",
    helperStart + 20,
  );

assert.ok(
  helperStart >= 0,
);

assert.ok(
  helperEnd > helperStart,
);

const helper =
  webhookSource.slice(
    helperStart,
    helperEnd,
  );

const disabledIndex =
  helper.indexOf(
    'skipped: "MIRROR_DISABLED"',
  );

const enqueueIndex =
  helper.indexOf(
    '"enqueue_line_message_mirror"',
  );

const wakeIndex =
  helper.indexOf(
    "wakeLineMirrorDestinationBestEffort",
  );

assert.ok(
  disabledIndex >= 0,
);

assert.ok(
  enqueueIndex > disabledIndex,
);

assert.ok(
  wakeIndex > enqueueIndex,
);

assert.match(
  helper,
  /process\.env\.URL/,
);

assert.match(
  helper,
  /LINE_MESSAGE_MIRROR_WORKER_SECRET/,
);

assert.match(
  helper,
  /LINE mirror wake exception/,
);

console.log(
  "PASS MIR2C-C-B2-01: disabled path remains before enqueue and wake",
);


// ------------------------------------------------------------
// Background wrapper remains dedicated and secret-authenticated.
// ------------------------------------------------------------

assert.match(
  workerSource,
  /background:\s*true/,
);

assert.match(
  workerSource,
  /x-line-message-mirror-worker-secret/,
);

assert.match(
  workerSource,
  /safeMirrorSecretEqual/,
);

assert.match(
  workerSource,
  /SUPABASE_SECRET_KEY/,
);

assert.match(
  workerSource,
  /LINE_CHANNEL_ACCESS_TOKEN/,
);

console.log(
  "PASS MIR2C-C-B2-02: background worker has independent secret boundary",
);


const silentLogger = {
  error() {},
  log() {},
};

const env = {
  LINE_MESSAGE_MIRROR_WORKER_SECRET:
    "worker-secret",

  LINE_MESSAGE_MIRROR_ENABLED:
    "true",

  LINE_CHANNEL_ACCESS_TOKEN:
    "line-token",

  URL:
    "https://example.netlify.app",
};


// ------------------------------------------------------------
// Wrong secret never reaches DB/transport.
// ------------------------------------------------------------

{
  let ran = false;

  const req =
    new Request(
      "https://example.netlify.app/.netlify/functions/line-message-mirror-background",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "x-line-message-mirror-worker-secret":
            "wrong-secret",
        },

        body:
          JSON.stringify({
            destination_line_group_id:
              "DEST",

            lease_token:
              "lease",
          }),
      },
    );

  await assert.rejects(
    () =>
      handleLineMessageMirrorBackground(
        req,
        {
          env,

          supabase: {},

          runWorker:
            async () => {
              ran = true;
            },

          logger:
            silentLogger,
        },
      ),
    /INVALID_MIRROR_WORKER_SECRET/,
  );

  assert.equal(
    ran,
    false,
  );
}

console.log(
  "PASS MIR2C-C-B2-03: invalid worker secret cannot enter transport",
);


// ------------------------------------------------------------
// Valid invocation forwards authoritative destination + lease.
// ------------------------------------------------------------

{
  const calls = [];

  const req =
    new Request(
      "https://example.netlify.app/.netlify/functions/line-message-mirror-background",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "x-line-message-mirror-worker-secret":
            "worker-secret",
        },

        body:
          JSON.stringify({
            destination_line_group_id:
              "DEST",

            lease_token:
              "lease-123",
          }),
      },
    );

  const result =
    await handleLineMessageMirrorBackground(
      req,
      {
        env,

        supabase: {
          rpc() {
            throw new Error(
              "SHOULD_NOT_BE_USED_BY_MOCK_WORKER",
            );
          },
        },

        runWorker:
          async (args) => {
            calls.push(
              args,
            );

            return {
              status:
                "BLOCKED_NON_TEXT",
            };
          },

        wakeDestination:
          async () => {
            throw new Error(
              "BLOCKED_NON_TEXT_MUST_NOT_HANDOFF",
            );
          },

        logger:
          silentLogger,
      },
    );

  assert.equal(
    result.status,
    "BLOCKED_NON_TEXT",
  );

  assert.equal(
    calls.length,
    1,
  );

  assert.equal(
    calls[0]
      .destinationLineGroupId,
    "DEST",
  );

  assert.equal(
    calls[0]
      .leaseToken,
    "lease-123",
  );

  assert.equal(
    calls[0]
      .lineChannelAccessToken,
    "line-token",
  );
}

console.log(
  "PASS MIR2C-C-B2-04: wrapper forwards destination lease and LINE token",
);


// ------------------------------------------------------------
// DRAINED performs post-release handoff wake.
//
// This closes:
//   enqueue -> ACTIVE_LEASE
//   old worker -> EMPTY -> release
// race.
// ------------------------------------------------------------

{
  const wakeCalls = [];

  const req =
    new Request(
      "https://example.netlify.app/.netlify/functions/line-message-mirror-background",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "x-line-message-mirror-worker-secret":
            "worker-secret",
        },

        body:
          JSON.stringify({
            destination_line_group_id:
              "DEST",

            lease_token:
              "lease-456",
          }),
      },
    );

  const result =
    await handleLineMessageMirrorBackground(
      req,
      {
        env,

        supabase: {
          marker:
            "supabase",
        },

        runWorker:
          async () => ({
            status:
              "DRAINED",

            batches_handled:
              3,
          }),

        wakeDestination:
          async (args) => {
            wakeCalls.push(
              args,
            );

            return {
              woken: false,
              skipped:
                "NO_WORK",
            };
          },

        logger:
          silentLogger,
      },
    );

  assert.equal(
    result.status,
    "DRAINED",
  );

  assert.equal(
    wakeCalls.length,
    1,
  );

  assert.equal(
    wakeCalls[0]
      .destinationLineGroupId,
    "DEST",
  );

  assert.equal(
    wakeCalls[0]
      .baseUrl,
    "https://example.netlify.app",
  );

  assert.equal(
    wakeCalls[0]
      .workerSecret,
    "worker-secret",
  );
}

console.log(
  "PASS MIR2C-C-B2-05: drained worker performs race-safe destination handoff",
);


// ------------------------------------------------------------
// BATCH_LIMIT_REACHED also hands off remaining work.
// ------------------------------------------------------------

{
  let wakes = 0;

  const req =
    new Request(
      "https://example.netlify.app/.netlify/functions/line-message-mirror-background",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "x-line-message-mirror-worker-secret":
            "worker-secret",
        },

        body:
          JSON.stringify({
            destination_line_group_id:
              "DEST",

            lease_token:
              "lease-789",
          }),
      },
    );

  await handleLineMessageMirrorBackground(
    req,
    {
      env,

      supabase: {},

      runWorker:
        async () => ({
          status:
            "BATCH_LIMIT_REACHED",
        }),

      wakeDestination:
        async () => {
          wakes += 1;

          return {
            woken: true,
          };
        },

      logger:
        silentLogger,
    },
  );

  assert.equal(
    wakes,
    1,
  );
}

console.log(
  "PASS MIR2C-C-B2-06: batch-limit exit hands remaining work to next worker",
);


// ------------------------------------------------------------
// BLOCKED_NON_TEXT deliberately does not spin.
//
// MIR2C-D will later own the unresolved image batch.
// ------------------------------------------------------------

{
  let wakes = 0;

  const req =
    new Request(
      "https://example.netlify.app/.netlify/functions/line-message-mirror-background",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "x-line-message-mirror-worker-secret":
            "worker-secret",
        },

        body:
          JSON.stringify({
            destination_line_group_id:
              "DEST",

            lease_token:
              "lease-image",
          }),
      },
    );

  await handleLineMessageMirrorBackground(
    req,
    {
      env,

      supabase: {},

      runWorker:
        async () => ({
          status:
            "BLOCKED_NON_TEXT",
        }),

      wakeDestination:
        async () => {
          wakes += 1;
        },

      logger:
        silentLogger,
    },
  );

  assert.equal(
    wakes,
    0,
  );
}

console.log(
  "PASS MIR2C-C-B2-07: text-only image blocker does not create wake loop",
);


// ------------------------------------------------------------
// Handoff wake failure is isolated from completed worker result.
// ------------------------------------------------------------

{
  const req =
    new Request(
      "https://example.netlify.app/.netlify/functions/line-message-mirror-background",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "x-line-message-mirror-worker-secret":
            "worker-secret",
        },

        body:
          JSON.stringify({
            destination_line_group_id:
              "DEST",

            lease_token:
              "lease-handoff",
          }),
      },
    );

  const result =
    await handleLineMessageMirrorBackground(
      req,
      {
        env,

        supabase: {},

        runWorker:
          async () => ({
            status:
              "DRAINED",
          }),

        wakeDestination:
          async () => {
            throw new Error(
              "HANDOFF_WAKE_FAILED",
            );
          },

        logger:
          silentLogger,
      },
    );

  assert.equal(
    result.status,
    "DRAINED",
  );
}

console.log(
  "PASS MIR2C-C-B2-08: handoff failure cannot rewrite completed transport state",
);



// ------------------------------------------------------------
// R1: valid secret is not enough; global Mirror switch must also
// be explicit true at the transport boundary.
// ------------------------------------------------------------

{
  let workerCalls = 0;
  let wakeCalls = 0;

  const req =
    new Request(
      "https://example.netlify.app/.netlify/functions/line-message-mirror-background",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "x-line-message-mirror-worker-secret":
            "worker-secret",
        },

        body:
          JSON.stringify({
            destination_line_group_id:
              "DEST",

            lease_token:
              "lease-disabled",
          }),
      },
    );

  const result =
    await handleLineMessageMirrorBackground(
      req,
      {
        env: {
          ...env,

          LINE_MESSAGE_MIRROR_ENABLED:
            "false",
        },

        supabase: {
          rpc() {
            throw new Error(
              "DISABLED_WORKER_MUST_NOT_TOUCH_DB",
            );
          },
        },

        runWorker:
          async () => {
            workerCalls += 1;

            throw new Error(
              "DISABLED_WORKER_MUST_NOT_RUN",
            );
          },

        wakeDestination:
          async () => {
            wakeCalls += 1;

            throw new Error(
              "DISABLED_WORKER_MUST_NOT_HANDOFF",
            );
          },

        logger:
          silentLogger,
      },
    );

  assert.deepEqual(
    result,
    {
      status:
        "MIRROR_DISABLED",

      batches_handled:
        0,
    },
  );

  assert.equal(
    workerCalls,
    0,
  );

  assert.equal(
    wakeCalls,
    0,
  );
}

console.log(
  "PASS MIR2C-C-B2-R1-01: valid worker secret cannot bypass global Mirror OFF",
);


// ------------------------------------------------------------
// R1: missing flag also fails closed.
// ------------------------------------------------------------

{
  let workerCalls = 0;

  const {
    LINE_MESSAGE_MIRROR_ENABLED:
      _removed,
    ...envWithoutFlag
  } = env;

  const req =
    new Request(
      "https://example.netlify.app/.netlify/functions/line-message-mirror-background",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "x-line-message-mirror-worker-secret":
            "worker-secret",
        },

        body:
          JSON.stringify({
            destination_line_group_id:
              "DEST",

            lease_token:
              "lease-missing-flag",
          }),
      },
    );

  const result =
    await handleLineMessageMirrorBackground(
      req,
      {
        env:
          envWithoutFlag,

        supabase: {},

        runWorker:
          async () => {
            workerCalls += 1;
          },

        logger:
          silentLogger,
      },
    );

  assert.equal(
    result.status,
    "MIRROR_DISABLED",
  );

  assert.equal(
    workerCalls,
    0,
  );
}

console.log(
  "PASS MIR2C-C-B2-R1-02: missing Mirror flag fails closed",
);



// ------------------------------------------------------------
// R2: webhook does not serialize independent destination wakes.
// ------------------------------------------------------------

{
  const helperStart =
    webhookSource.indexOf(
      "async function enqueueLineMessageMirrorBestEffort",
    );

  const helperEnd =
    webhookSource.indexOf(
      "\nasync function ",
      helperStart + 20,
    );

  const helper =
    webhookSource.slice(
      helperStart,
      helperEnd,
    );

  assert.match(
    helper,
    /await Promise\.all\(/,
  );

  assert.match(
    helper,
    /destinations\.map\(/,
  );

  const promiseIndex =
    helper.indexOf(
      "await Promise.all(",
    );

  const wakeIndex =
    helper.indexOf(
      "wakeLineMirrorDestinationBestEffort",
      promiseIndex,
    );

  assert.ok(
    promiseIndex >= 0,
  );

  assert.ok(
    wakeIndex > promiseIndex,
  );
}

console.log(
  "PASS MIR2C-C-B2-R2-02: independent destination wakes are concurrent",
);

console.log(
  "PASS: LINE Mirror background wake integration v1",
);
