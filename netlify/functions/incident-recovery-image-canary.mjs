import {
  json,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  processEvent,
} from "./line-webhook.mjs";

const EXPECTED_ROUNDS = new Map([
  ["EAST", 9],
  ["SOUTH", 2],
  ["SOUTHEAST", 3],
  ["SOUTHWEST", 2],
]);

const EXPECTED_BATCH = {
  EAST:      { text: 8,   image: 5   },
  SOUTH:     { text: 228, image: 117 },
  SOUTHEAST: { text: 404, image: 68  },
  SOUTHWEST: { text: 3,   image: 7   },
};

function fail(message, status = 409, extra = {}) {
  return json({
    ok: false,
    error: message,
    ...extra,
  }, status);
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return fail("METHOD_NOT_ALLOWED", 405);
  }

  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  let body;
  try {
    body = await req.json();
  } catch {
    return fail("INVALID_JSON", 400);
  }

  if (body?.action !== "IMAGE_CANARY_5") {
    return fail("INVALID_ACTION", 400);
  }

  try {
    const { data: openRounds, error: openError } = await supabase
      .from("settlement_summary_group_rounds")
      .select("id,summary_group_id,round_no,status")
      .eq("status", "OPEN");

    if (openError) throw openError;

    const openGroups = (openRounds ?? [])
      .map((row) => row.summary_group_id)
      .sort();

    // Incident recovery now runs only while every Summary Group
    // is CLOSED. This prevents recovery work from overlapping
    // with any newly opened live round.
    if (openGroups.length !== 0) {
      return fail(
        `OPEN_ROUNDS_PRESENT_${openGroups.join("_")}`,
      );
    }

    const { data: roundRows, error: roundError } = await supabase
      .from("settlement_summary_group_rounds")
      .select("id,summary_group_id,round_no,business_date,status")
      .eq("status", "CLOSED")
      .eq("business_date", "2026-09-30")
      .in("summary_group_id", [...EXPECTED_ROUNDS.keys()]);

    if (roundError) throw roundError;

    const recoveryRounds = (roundRows ?? []).filter(
      (row) => EXPECTED_ROUNDS.get(row.summary_group_id) === Number(row.round_no),
    );

    if (recoveryRounds.length !== 4) {
      return fail(`EXPECTED_4_RECOVERY_ROUNDS_FOUND_${recoveryRounds.length}`);
    }

    const roundIds = recoveryRounds.map((row) => row.id);

    const { data: recentMessages, error: messageError } = await supabase
      .from("messages")
      .select([
        "id",
        "webhook_event_id",
        "summary_group_id",
        "summary_group_round_id",
        "message_type",
        "parse_status",
        "created_at",
        "event_timestamp",
      ].join(","))
      .in("summary_group_round_id", roundIds)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (messageError) throw messageError;

    const byCreatedAt = new Map();
    for (const row of recentMessages ?? []) {
      const rows = byCreatedAt.get(row.created_at) ?? [];
      rows.push(row);
      byCreatedAt.set(row.created_at, rows);
    }

    const batches = [...byCreatedAt.entries()]
      .filter(([, rows]) => rows.length === 840)
      .sort(
        ([a], [b]) =>
          new Date(b).getTime() - new Date(a).getTime(),
      );

    if (!batches.length) {
      return fail("RECOVERY_BATCH_840_NOT_FOUND");
    }

    const [batchCreatedAt, batch] = batches[0];

    const actual = {};
    for (const row of batch) {
      actual[row.summary_group_id] ??= { text: 0, image: 0 };
      if (row.message_type === "text" || row.message_type === "image") {
        actual[row.summary_group_id][row.message_type]++;
      }
    }

    for (const [group, expected] of Object.entries(EXPECTED_BATCH)) {
      const observed = actual[group] ?? { text: 0, image: 0 };
      if (
        observed.text !== expected.text ||
        observed.image !== expected.image
      ) {
        return fail(`BATCH_COMPOSITION_MISMATCH_${group}`);
      }
    }

    const pendingText = batch.filter(
      (row) =>
        row.message_type === "text" &&
        row.parse_status === "PENDING",
    ).length;

    if (pendingText !== 0) {
      return fail(`PENDING_TEXT_REMAINING_${pendingText}`);
    }

    const pendingImages = batch
      .filter(
        (row) =>
          row.message_type === "image" &&
          row.parse_status === "PENDING",
      )
      .sort(
        (a, b) =>
          new Date(a.event_timestamp).getTime()
          - new Date(b.event_timestamp).getTime()
          || String(a.webhook_event_id).localeCompare(
            String(b.webhook_event_id),
          ),
      );

    if (!pendingImages.length) {
      return json({
        ok: true,
        action: "IMAGE_CANARY_5",
        processed: 0,
        image_complete: true,
        recovery_pending_image: 0,
        recovery_pending_total: 0,
        webhook: "KEEP_OFF",
      });
    }

    const targets = pendingImages.slice(0, 5);
    if (targets.length !== 5) {
      return fail(`EXPECTED_5_IMAGE_CANARIES_FOUND_${targets.length}`);
    }

    const eventIds = targets.map((row) => row.webhook_event_id);
    const messageIds = targets.map((row) => row.id);

    const { count: itemCountBefore, error: itemBeforeError } = await supabase
      .from("order_items")
      .select("id", {
        count: "exact",
        head: true,
      })
      .in("message_record_id", messageIds);

    if (itemBeforeError) throw itemBeforeError;

    if (Number(itemCountBefore ?? 0) !== 0) {
      return fail(`CANARY_ALREADY_HAS_ORDER_ITEMS_${itemCountBefore}`);
    }

    const { count: reviewCountBefore, error: reviewBeforeError } = await supabase
      .from("review_items")
      .select("id", {
        count: "exact",
        head: true,
      })
      .in("message_record_id", messageIds);

    if (reviewBeforeError) throw reviewBeforeError;

    if (Number(reviewCountBefore ?? 0) !== 0) {
      return fail(`CANARY_ALREADY_HAS_REVIEW_ITEMS_${reviewCountBefore}`);
    }

    const { data: eventRows, error: eventError } = await supabase
      .from("webhook_events")
      .select([
        "webhook_event_id",
        "destination",
        "payload",
        "processed_at",
        "processing_started_at",
        "attempt_count",
        "last_error",
      ].join(","))
      .in("webhook_event_id", eventIds);

    if (eventError) throw eventError;

    if ((eventRows ?? []).length !== 5) {
      return fail(`EXPECTED_5_WEBHOOK_EVENTS_FOUND_${eventRows?.length ?? 0}`);
    }

    const eventsById = new Map(
      eventRows.map((row) => [row.webhook_event_id, row]),
    );

    for (const target of targets) {
      const event = eventsById.get(target.webhook_event_id);

      if (!event) {
        return fail("WEBHOOK_EVENT_MISSING");
      }

      if (
        event.processed_at !== null ||
        event.processing_started_at !== null
      ) {
        return fail(`TARGET_NOT_RECLAIM_READY_${target.webhook_event_id}`);
      }
    }

    const results = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const event = eventsById.get(target.webhook_event_id);

      try {
        const result = await processEvent(
          event.destination,
          event.payload,
        );

        results.push({
          index: i + 1,
          summary_group_id: target.summary_group_id,
          result,
        });
      } catch (error) {
        return fail(
          "IMAGE_CANARY_PROCESSING_FAILED",
          500,
          {
            completed: results.length,
            failed_index: i + 1,
            failed_group: target.summary_group_id,
            detail: error?.message ?? String(error),
            results,
          },
        );
      }
    }

    const { data: afterEvents, error: afterEventError } = await supabase
      .from("webhook_events")
      .select(
        "webhook_event_id,processed_at,processing_started_at,last_error"
      )
      .in("webhook_event_id", eventIds);

    if (afterEventError) throw afterEventError;

    const badEvents = (afterEvents ?? []).filter(
      (row) =>
        !row.processed_at ||
        row.processing_started_at !== null ||
        row.last_error !== null,
    );

    if (badEvents.length) {
      return fail(`WEBHOOK_VERIFY_FAILED_${badEvents.length}`, 500);
    }

    const { data: afterMessages, error: afterMessageError } = await supabase
      .from("messages")
      .select("id,summary_group_id,parse_status,parser_version")
      .in("id", messageIds);

    if (afterMessageError) throw afterMessageError;

    const stillPending = (afterMessages ?? []).filter(
      (row) => row.parse_status === "PENDING",
    );

    if (stillPending.length) {
      return fail(`TARGETS_STILL_PENDING_${stillPending.length}`, 500);
    }

    const { data: reviewRows, error: reviewError } = await supabase
      .from("review_items")
      .select("message_record_id,reason_codes,warnings")
      .in("message_record_id", messageIds);

    if (reviewError) throw reviewError;

    const closedRoundReviews = (reviewRows ?? []).filter(
      (row) =>
        JSON.stringify(row.reason_codes ?? []).includes("SUMMARY_GROUP_CLOSED"),
    );

    if (closedRoundReviews.length) {
      return fail(`SUMMARY_GROUP_CLOSED_DETECTED_${closedRoundReviews.length}`, 500);
    }

    const { count: itemCountAfter, error: itemAfterError } = await supabase
      .from("order_items")
      .select("id", {
        count: "exact",
        head: true,
      })
      .in("message_record_id", messageIds);

    if (itemAfterError) throw itemAfterError;

    const { data: batchAfter, error: batchAfterError } = await supabase
      .from("messages")
      .select("id,message_type,parse_status")
      .eq("created_at", batchCreatedAt)
      .in("summary_group_round_id", roundIds);

    if (batchAfterError) throw batchAfterError;

    const remainingImage = (batchAfter ?? []).filter(
      (row) =>
        row.message_type === "image" &&
        row.parse_status === "PENDING",
    ).length;

    const remainingTotal = (batchAfter ?? []).filter(
      (row) => row.parse_status === "PENDING",
    ).length;

    const statuses = {};
    for (const row of afterMessages ?? []) {
      statuses[row.parse_status] =
        (statuses[row.parse_status] ?? 0) + 1;
    }

    return json({
      ok: true,
      action: "IMAGE_CANARY_5",
      processed: targets.length,
      statuses,
      review_items_created: Number(reviewRows?.length ?? 0),
      order_items_created: Number(itemCountAfter ?? 0),
      recovery_pending_image: remainingImage,
      recovery_pending_total: remainingTotal,
      batch_created_at: batchCreatedAt,
      results,
      webhook: "KEEP_OFF",
    });
  } catch (error) {
    console.error("incident recovery image canary failed", error);

    return json({
      ok: false,
      error: error?.message ?? String(error),
    }, 500);
  }
}

export const config = {
  path: "/api/incident-recovery-image-canary",
  region: "sin",
};
