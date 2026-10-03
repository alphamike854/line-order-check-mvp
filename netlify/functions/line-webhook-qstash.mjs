"use strict";

import { Receiver } from "@upstash/qstash";

import {
  processEvent,
} from "./line-webhook.mjs";

function json(body, status = 200) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
      },
    },
  );
}

export default async (req) => {
  if (req.method !== "POST") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  const currentSigningKey =
    String(
      process.env.QSTASH_CURRENT_SIGNING_KEY
      ?? "",
    ).trim();

  const nextSigningKey =
    String(
      process.env.QSTASH_NEXT_SIGNING_KEY
      ?? "",
    ).trim();

  if (
    !currentSigningKey
    || !nextSigningKey
  ) {
    return json(
      {
        ok: false,
        error: "QSTASH_SIGNING_KEYS_MISSING",
      },
      503,
    );
  }

  const signature =
    req.headers.get("upstash-signature");

  if (!signature) {
    return json(
      {
        ok: false,
        error: "QSTASH_SIGNATURE_MISSING",
      },
      401,
    );
  }

  const rawBody = await req.text();

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
      "QStash signature verification failed",
      error,
    );
  }

  if (!verified) {
    return json(
      {
        ok: false,
        error: "INVALID_QSTASH_SIGNATURE",
      },
      401,
    );
  }

  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(
      {
        ok: false,
        error: "INVALID_JSON",
      },
      400,
    );
  }

  const destination =
    payload?.destination;

  const event =
    payload?.event;

  if (
    !destination
    || !event?.webhookEventId
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_QSTASH_EVENT",
      },
      400,
    );
  }

  try {
    const result =
      await processEvent(
        destination,
        event,
      );

    /*
     * claim_webhook_event may still own an
     * active claim from an earlier delivery.
     *
     * Returning non-2xx makes QStash retry
     * later instead of treating IN_FLIGHT
     * as completed.
     */
    if (
      result?.skipped
      === "EVENT_IN_FLIGHT"
    ) {
      return json(
        {
          ok: false,
          error: "EVENT_IN_FLIGHT_RETRY",
        },
        503,
      );
    }

    return json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "QStash LINE event processing failed",
      event.webhookEventId,
      error,
    );

    return json(
      {
        ok: false,
        error: "PROCESSING_FAILED",
      },
      500,
    );
  }
};

export const config = {
  path: "/api/line-webhook-qstash",
  region: "sin",
};
