"use strict";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  runLineMirrorDestinationWorker,
  safeMirrorSecretEqual,
  wakeLineMirrorDestinationBestEffort,
} from "../../src/lib/line-message-mirror-transport.mjs";


function isLineMessageMirrorEnabled(
  env,
) {
  return (
    String(
      env.LINE_MESSAGE_MIRROR_ENABLED
        ?? "",
    )
      .trim()
      .toLowerCase()
    === "true"
  );
}


function createMirrorSupabaseClient(
  env,
) {
  const url =
    env.SUPABASE_URL;

  const secretKey =
    env.SUPABASE_SECRET_KEY;

  if (
    !url
    || !secretKey
  ) {
    throw new Error(
      "MIRROR_SUPABASE_ENV_MISSING",
    );
  }

  return createClient(
    url,
    secretKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}


export async function handleLineMessageMirrorBackground(
  req,
  {
    env = process.env,
    supabase = null,
    runWorker =
      runLineMirrorDestinationWorker,
    wakeDestination =
      wakeLineMirrorDestinationBestEffort,
    logger = console,
  } = {},
) {
  if (req.method !== "POST") {
    throw new Error(
      "METHOD_NOT_ALLOWED",
    );
  }

  const expectedSecret =
    String(
      env.LINE_MESSAGE_MIRROR_WORKER_SECRET
        ?? "",
    );

  if (!expectedSecret) {
    throw new Error(
      "LINE_MESSAGE_MIRROR_WORKER_SECRET_MISSING",
    );
  }

  const suppliedSecret =
    req.headers.get(
      "x-line-message-mirror-worker-secret",
    );

  if (
    !safeMirrorSecretEqual(
      suppliedSecret,
      expectedSecret,
    )
  ) {
    throw new Error(
      "INVALID_MIRROR_WORKER_SECRET",
    );
  }

  // Global emergency stop applies at the transport boundary too.
  //
  // The webhook gate prevents new Mirror enqueue/wake work, while this
  // second gate prevents an already-accepted background invocation,
  // delayed Netlify retry, or direct secret-authenticated invocation
  // from sending LINE messages after Mirror has been disabled.
  //
  // Only explicit normalized "true" enables transport.
  if (
    !isLineMessageMirrorEnabled(
      env,
    )
  ) {
    return {
      status:
        "MIRROR_DISABLED",

      batches_handled:
        0,
    };
  }

  let payload;

  try {
    payload =
      await req.json();
  } catch {
    throw new Error(
      "INVALID_JSON",
    );
  }

  const destinationLineGroupId =
    String(
      payload
        ?.destination_line_group_id
        ?? "",
    ).trim();

  const leaseToken =
    String(
      payload
        ?.lease_token
        ?? "",
    ).trim();

  if (!destinationLineGroupId) {
    throw new Error(
      "MIRROR_DESTINATION_REQUIRED",
    );
  }

  if (!leaseToken) {
    throw new Error(
      "MIRROR_LEASE_TOKEN_REQUIRED",
    );
  }

  const client =
    supabase
    ?? createMirrorSupabaseClient(
      env,
    );

  const result =
    await runWorker({
      supabase:
        client,

      destinationLineGroupId,

      leaseToken,

      lineChannelAccessToken:
        env.LINE_CHANNEL_ACCESS_TOKEN,
      destinationBaseUrl:
        env.URL,

      logger,
    });

  // Drain handoff:
  //
  // There is a narrow race where enqueue observes ACTIVE_LEASE
  // just before this worker sees EMPTY and releases that lease.
  //
  // runLineMirrorDestinationWorker() releases its lease before
  // returning DRAINED/BATCH_LIMIT_REACHED. Re-reserving here is
  // therefore an atomic-ish handoff through the DB:
  //
  //   - no new work -> reserve returns NO_WORK
  //   - new work appeared -> reserve succeeds and launches worker
  //   - another worker won -> ACTIVE_LEASE and no duplicate worker
  //
  // This prevents a committed queue row from being stranded merely
  // because its enqueue wake raced with an exiting worker.
  if (
    result?.status
      === "DRAINED"
    || result?.status
      === "BATCH_LIMIT_REACHED"
  ) {
    try {
      await wakeDestination({
        supabase:
          client,

        destinationLineGroupId,

        baseUrl:
          env.URL,

        workerSecret:
          expectedSecret,

        logger,
      });
    } catch (error) {
      // Handoff wake is secondary. Any future admitted message can
      // wake the same destination again. Never rewrite the completed
      // transport state because this best-effort handoff failed.
      logger?.error?.(
        "LINE mirror drain handoff wake failed",
        destinationLineGroupId,
        error,
      );
    }
  }

  return result;
}


export default async (req) => {
  await handleLineMessageMirrorBackground(
    req,
  );
};


export const config = {
  background: true,
};
