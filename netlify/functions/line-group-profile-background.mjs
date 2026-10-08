"use strict";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  fetchLineGroupSummary,
} from "../../src/lib/line-group-profile.mjs";

import {
  verifyLineSignature,
} from "./line-webhook.mjs";


const LINE_CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN;

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY;


const supabase =
  createClient(
    SUPABASE_URL ?? "",
    SUPABASE_SECRET_KEY ?? "",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );


function lineIngressSeenAt(
  timestamp,
) {
  const numeric =
    Number(timestamp);

  if (Number.isFinite(numeric)) {
    const date =
      new Date(numeric);

    if (
      Number.isFinite(
        date.getTime(),
      )
    ) {
      return date.toISOString();
    }
  }

  return new Date().toISOString();
}


function latestGroupEvents(
  events,
) {
  const latestByGroup =
    new Map();

  for (const event of events ?? []) {
    if (
      event?.source?.type
        !== "group"
    ) {
      continue;
    }

    const lineGroupId =
      String(
        event.source?.groupId
        ?? "",
      ).trim();

    if (!lineGroupId) {
      continue;
    }

    const eventType =
      String(
        event.type
        ?? "",
      ).trim()
      || null;

    const seenAt =
      lineIngressSeenAt(
        event.timestamp,
      );

    const seenAtMs =
      Date.parse(seenAt);

    const existing =
      latestByGroup.get(
        lineGroupId,
      );

    const sawJoin =
      eventType === "join"
      || Boolean(
        existing?.saw_join,
      );

    if (
      existing
      && existing.seen_at_ms
        > seenAtMs
    ) {
      existing.saw_join =
        sawJoin;

      continue;
    }

    latestByGroup.set(
      lineGroupId,
      {
        line_group_id:
          lineGroupId,

        seen_at:
          seenAt,

        seen_at_ms:
          seenAtMs,

        event_type:
          eventType,

        webhook_event_id:
          String(
            event.webhookEventId
            ?? "",
          ).trim()
          || null,

        saw_join:
          sawJoin,
      },
    );
  }

  return [
    ...latestByGroup.values(),
  ];
}


async function syncGroupProfile(
  observed,
) {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      "observe_line_group_ingress_v2",
      {
        p_line_group_id:
          observed.line_group_id,

        p_seen_at:
          observed.seen_at,

        p_event_type:
          observed.event_type,

        p_webhook_event_id:
          observed.webhook_event_id,
      },
    );

  if (error) {
    throw error;
  }

  /*
   * The RPC returns the CURRENT lifecycle truth.
   *
   * Therefore, if a newer leave webhook has already arrived while
   * this background invocation was waiting, membership_status is LEFT
   * and Group Summary is not called for the stale event.
   */
  const currentlyInGroup =
    data?.membership_status
    === "IN_GROUP";

  const shouldSyncName =
    currentlyInGroup
    && (
      observed.saw_join
      || data?.needs_name_sync
        === true
    );

  if (!shouldSyncName) {
    return;
  }

  const summary =
    await fetchLineGroupSummary({
      lineGroupId:
        observed.line_group_id,

      channelAccessToken:
        LINE_CHANNEL_ACCESS_TOKEN,
    });

  /*
   * A 404 means LINE no longer provides Group Summary to this OA.
   * Do not invent a name and do not rewrite lifecycle history.
   */
  if (
    summary.status
    !== "FOUND"
  ) {
    return;
  }

  const {
    data: stored,
    error: storeError,
  } =
    await supabase.rpc(
      "set_observed_line_group_name",
      {
        p_line_group_id:
          observed.line_group_id,

        p_group_name:
          summary.group_name,

        p_synced_at:
          new Date().toISOString(),
      },
    );

  if (storeError) {
    throw storeError;
  }

  if (stored !== true) {
    throw new Error(
      "LINE_GROUP_NAME_STORE_REJECTED",
    );
  }
}


export default async (req) => {
  if (req.method !== "POST") {
    throw new Error(
      "METHOD_NOT_ALLOWED",
    );
  }

  if (
    !LINE_CHANNEL_ACCESS_TOKEN
    || !SUPABASE_URL
    || !SUPABASE_SECRET_KEY
  ) {
    throw new Error(
      "LINE_GROUP_PROFILE_BACKGROUND_NOT_CONFIGURED",
    );
  }

  const rawBody =
    await req.text();

  const signature =
    req.headers.get(
      "x-line-signature",
    );

  /*
   * This endpoint is publicly reachable.
   * Verify the original LINE body independently before doing any work.
   */
  if (
    !verifyLineSignature(
      rawBody,
      signature,
    )
  ) {
    throw new Error(
      "INVALID_LINE_SIGNATURE",
    );
  }

  let payload;

  try {
    payload =
      JSON.parse(
        rawBody,
      );
  } catch {
    throw new Error(
      "INVALID_JSON",
    );
  }

  const observedGroups =
    latestGroupEvents(
      Array.isArray(
        payload?.events,
      )
        ? payload.events
        : [],
    );

  const failures =
    [];

  /*
   * Keep LINE API calls sequential.
   * A LINE webhook can contain multiple events and profile enrichment
   * must not create an avoidable burst against the Messaging API.
   */
  for (
    const observed
    of observedGroups
  ) {
    try {
      await syncGroupProfile(
        observed,
      );
    } catch (error) {
      failures.push({
        line_group_id:
          observed.line_group_id,

        error:
          error?.message
          ?? String(error),
      });
    }
  }

  /*
   * Background failure is isolated from order ingress.
   * Throwing lets Netlify retry this enrichment invocation while
   * all database operations remain idempotent.
   */
  if (failures.length) {
    throw new Error(
      `LINE_GROUP_PROFILE_BACKGROUND_FAILED: ${
        JSON.stringify(
          failures,
        ).slice(
          0,
          1800,
        )
      }`,
    );
  }
};


export const config = {
  background: true,
  region: "sin",
};
