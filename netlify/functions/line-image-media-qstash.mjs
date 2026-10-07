"use strict";

import {
  Receiver,
} from "@upstash/qstash";

import {
  processImageMediaJob,
} from "./line-webhook.mjs";

function json(
  body,
  status = 200,
  headers = {},
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        ...headers,
      },
    },
  );
}

export default async (req) => {
  if (req.method !== "POST") {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  const currentSigningKey =
    String(
      process.env
        .QSTASH_CURRENT_SIGNING_KEY
        ?? "",
    ).trim();

  const nextSigningKey =
    String(
      process.env
        .QSTASH_NEXT_SIGNING_KEY
        ?? "",
    ).trim();

  if (
    !currentSigningKey
    || !nextSigningKey
  ) {
    return json(
      {
        ok: false,
        error:
          "QSTASH_SIGNING_KEYS_MISSING",
      },
      503,
    );
  }

  const signature =
    req.headers.get(
      "upstash-signature",
    );

  if (!signature) {
    return json(
      {
        ok: false,
        error:
          "QSTASH_SIGNATURE_MISSING",
      },
      401,
    );
  }

  const rawBody =
    await req.text();

  const receiver =
    new Receiver({
      currentSigningKey,
      nextSigningKey,
    });

  let verified = false;

  try {
    verified =
      await receiver.verify({
        body: rawBody,
        signature,
        url: req.url,
      });
  } catch (error) {
    console.error(
      "Image media QStash signature verification failed",
      error,
    );
  }

  if (!verified) {
    return json(
      {
        ok: false,
        error:
          "INVALID_QSTASH_SIGNATURE",
      },
      401,
    );
  }

  let payload;

  try {
    payload =
      JSON.parse(rawBody);
  } catch {
    return json(
      {
        ok: false,
        error:
          "INVALID_JSON",
      },
      400,
    );
  }

  const destination =
    payload?.destination;

  const event =
    payload?.event;

  const messageId =
    payload?.message_id;

  const summaryGroupRoundId =
    payload?.summary_group_round_id;

  if (
    !destination
    || !event?.webhookEventId
    || event?.message?.type
      !== "image"
    || !messageId
    || !summaryGroupRoundId
  ) {
    return json(
      {
        ok: false,
        error:
          "INVALID_IMAGE_MEDIA_JOB",
      },
      400,
    );
  }

  const retried =
    Math.max(
      0,
      Number(
        req.headers.get(
          "upstash-retried",
        )
        ?? 0,
      ) || 0,
    );

  const processingAttempt =
    retried + 1;

  try {
    const result =
      await processImageMediaJob({
        destination,
        event,
        messageId,
        summaryGroupRoundId,
        processingAttempt,
      });

    return json({
      ok: true,
      processing_attempt:
        processingAttempt,
      result,
    });
  } catch (error) {
    console.error(
      "Image media QStash processing failed",
      event.webhookEventId,
      error,
    );

    return json(
      {
        ok: false,
        error:
          "IMAGE_MEDIA_PROCESSING_FAILED",
        processing_attempt:
          processingAttempt,
      },
      500,
    );
  }
};

export const config = {
  path:
    "/api/line-image-media-qstash",
  region: "sin",
};
