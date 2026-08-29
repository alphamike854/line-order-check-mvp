"use strict";

import {
  processEvent,
  verifyLineSignature,
} from "./line-webhook.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    throw new Error("METHOD_NOT_ALLOWED");
  }

  const rawBody = await req.text();
  const signature =
    req.headers.get("x-line-signature");

  // The background endpoint is publicly reachable, so independently
  // verify the original LINE signature again. The gateway forwards
  // the raw body byte-for-byte with the original signature.
  if (!verifyLineSignature(rawBody, signature)) {
    throw new Error("INVALID_LINE_SIGNATURE");
  }

  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error("INVALID_JSON");
  }

  const destination = payload.destination;

  const events =
    Array.isArray(payload.events)
      ? payload.events
      : [];

  const failures = [];

  // Keep processing sequentially for now. This avoids multiplying
  // concurrent LINE image downloads / Gemini OCR requests when one
  // LINE webhook contains several events.
  for (const event of events) {
    try {
      const result = await processEvent(
        destination,
        event,
      );

      // claim_webhook_event keeps an active claim for up to 2 minutes.
      //
      // A Netlify background retry can occur before that stale-claim
      // window expires. Treat IN_FLIGHT as retryable instead of success,
      // so a later retry can reclaim the event after the stale window.
      if (result?.skipped === "EVENT_IN_FLIGHT") {
        failures.push({
          webhookEventId:
            event?.webhookEventId ?? null,
          error: "EVENT_IN_FLIGHT_RETRY",
        });
      }
    } catch (error) {
      failures.push({
        webhookEventId:
          event?.webhookEventId ?? null,
        error:
          error?.message ??
          String(error),
      });
    }
  }

  // Successful events are already idempotently marked DONE.
  // Throwing here lets Netlify retry the background invocation;
  // on retry, completed events are skipped and failed events can
  // reclaim/reprocess through claim_webhook_event.
  if (failures.length) {
    throw new Error(
      `BACKGROUND_PROCESSING_FAILED: ${JSON.stringify(failures).slice(0, 1800)}`,
    );
  }
};

export const config = {
  background: true,
};
