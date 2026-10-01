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

  if (body?.action !== "IMAGE_ONE") {
    return fail("INVALID_ACTION", 400);
  }

  try {
    // Recovery is allowed only while every live round is closed.
    const {
      data: openRounds,
      error: openError,
    } = await supabase
      .from("settlement_summary_group_rounds")
      .select("id,summary_group_id")
      .eq("status", "OPEN");

    if (openError) throw openError;

    if ((openRounds ?? []).length !== 0) {
      return fail(
        "OPEN_ROUNDS_PRESENT_" +
        (openRounds ?? [])
          .map((r) => r.summary_group_id)
          .sort()
          .join("_"),
      );
    }

    // Resolve exact incident rounds.
    const {
      data: roundRows,
      error: roundError,
    } = await supabase
      .from("settlement_summary_group_rounds")
      .select(
        "id,summary_group_id,round_no,business_date,status"
      )
      .eq("status", "CLOSED")
      .eq("business_date", "2026-09-30")
      .in(
        "summary_group_id",
        [...EXPECTED_ROUNDS.keys()],
      );

    if (roundError) throw roundError;

    const recoveryRounds =
      (roundRows ?? []).filter(
        (row) =>
          EXPECTED_ROUNDS.get(row.summary_group_id)
          === Number(row.round_no),
      );

    if (recoveryRounds.length !== 4) {
      return fail(
        `EXPECTED_4_RECOVERY_ROUNDS_FOUND_${recoveryRounds.length}`,
      );
    }

    const roundIds =
      recoveryRounds.map((row) => row.id);

    // Locate immutable 840-row skeleton batch.
    const {
      data: recentMessages,
      error: messageError,
    } = await supabase
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
      const rows =
        byCreatedAt.get(row.created_at) ?? [];

      rows.push(row);
      byCreatedAt.set(row.created_at, rows);
    }

    const batches =
      [...byCreatedAt.entries()]
        .filter(([, rows]) => rows.length === 840)
        .sort(
          ([a], [b]) =>
            new Date(b).getTime()
            - new Date(a).getTime(),
        );

    if (!batches.length) {
      return fail("RECOVERY_BATCH_840_NOT_FOUND");
    }

    const [batchCreatedAt, batch] = batches[0];

    // Text recovery must already be complete.
    const pendingText =
      batch.filter(
        (row) =>
          row.message_type === "text"
          && row.parse_status === "PENDING",
      ).length;

    if (pendingText !== 0) {
      return fail(
        `PENDING_TEXT_REMAINING_${pendingText}`,
      );
    }

    const pendingImages =
      batch
        .filter(
          (row) =>
            row.message_type === "image"
            && row.parse_status === "PENDING",
        )
        .sort(
          (a, b) =>
            new Date(a.event_timestamp).getTime()
            - new Date(b.event_timestamp).getTime()
            || String(a.webhook_event_id)
              .localeCompare(
                String(b.webhook_event_id),
              ),
        );

    if (!pendingImages.length) {
      return json({
        ok: true,
        action: "IMAGE_ONE",
        processed: 0,
        image_complete: true,
        recovery_pending_image: 0,
        recovery_pending_total: 0,
        webhook: "KEEP_OFF",
      });
    }

    // Exactly one image per request.
    const target = pendingImages[0];

    // It must not have existing derived business/review output.
    const {
      count: itemCountBefore,
      error: itemBeforeError,
    } = await supabase
      .from("order_items")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq(
        "message_record_id",
        target.id,
      );

    if (itemBeforeError) throw itemBeforeError;

    if (Number(itemCountBefore ?? 0) !== 0) {
      return fail(
        `TARGET_ALREADY_HAS_ORDER_ITEMS_${itemCountBefore}`,
      );
    }

    const {
      count: reviewCountBefore,
      error: reviewBeforeError,
    } = await supabase
      .from("review_items")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq(
        "message_record_id",
        target.id,
      );

    if (reviewBeforeError) throw reviewBeforeError;

    if (Number(reviewCountBefore ?? 0) !== 0) {
      return fail(
        `TARGET_ALREADY_HAS_REVIEW_ITEMS_${reviewCountBefore}`,
      );
    }

    // Exact webhook event must be reclaim-ready.
    const {
      data: event,
      error: eventError,
    } = await supabase
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
      .eq(
        "webhook_event_id",
        target.webhook_event_id,
      )
      .single();

    if (eventError) throw eventError;

    if (
      event.processed_at !== null
      || event.processing_started_at !== null
    ) {
      return fail(
        `TARGET_NOT_RECLAIM_READY_${target.webhook_event_id}`,
      );
    }

    // Process one image through the normal production engine.
    let result;

    try {
      result = await processEvent(
        event.destination,
        event.payload,
      );
    } catch (error) {
      return fail(
        "IMAGE_PROCESSING_FAILED",
        500,
        {
          summary_group_id:
            target.summary_group_id,
          detail:
            error?.message ?? String(error),
        },
      );
    }

    // Verify webhook completion.
    const {
      data: afterEvent,
      error: afterEventError,
    } = await supabase
      .from("webhook_events")
      .select(
        "processed_at,processing_started_at,last_error,attempt_count"
      )
      .eq(
        "webhook_event_id",
        target.webhook_event_id,
      )
      .single();

    if (afterEventError) throw afterEventError;

    if (
      !afterEvent.processed_at
      || afterEvent.processing_started_at !== null
      || afterEvent.last_error !== null
    ) {
      return fail(
        "WEBHOOK_VERIFY_FAILED",
        500,
      );
    }

    // Verify message moved off PENDING.
    const {
      data: afterMessage,
      error: afterMessageError,
    } = await supabase
      .from("messages")
      .select(
        "id,parse_status,ocr_status,parser_version,ocr_error"
      )
      .eq("id", target.id)
      .single();

    if (afterMessageError) throw afterMessageError;

    if (afterMessage.parse_status === "PENDING") {
      return fail(
        "TARGET_STILL_PENDING",
        500,
      );
    }

    // Closed-round rejection must never occur.
    const {
      data: reviewRows,
      error: reviewError,
    } = await supabase
      .from("review_items")
      .select(
        "reason_codes,warnings"
      )
      .eq(
        "message_record_id",
        target.id,
      );

    if (reviewError) throw reviewError;

    if (
      (reviewRows ?? []).some(
        (row) =>
          JSON.stringify(row.reason_codes ?? [])
            .includes("SUMMARY_GROUP_CLOSED"),
      )
    ) {
      return fail(
        "SUMMARY_GROUP_CLOSED_DETECTED",
        500,
      );
    }

    const {
      count: itemCountAfter,
      error: itemAfterError,
    } = await supabase
      .from("order_items")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq(
        "message_record_id",
        target.id,
      );

    if (itemAfterError) throw itemAfterError;

    // Fresh total from exact recovery batch.
    const {
      data: batchAfter,
      error: batchAfterError,
    } = await supabase
      .from("messages")
      .select(
        "id,message_type,parse_status"
      )
      .eq(
        "created_at",
        batchCreatedAt,
      )
      .in(
        "summary_group_round_id",
        roundIds,
      );

    if (batchAfterError) throw batchAfterError;

    const remainingImage =
      (batchAfter ?? []).filter(
        (row) =>
          row.message_type === "image"
          && row.parse_status === "PENDING",
      ).length;

    const remainingTotal =
      (batchAfter ?? []).filter(
        (row) =>
          row.parse_status === "PENDING",
      ).length;

    return json({
      ok: true,
      action: "IMAGE_ONE",
      processed: 1,
      summary_group_id:
        target.summary_group_id,
      status:
        afterMessage.parse_status,
      ocr_status:
        afterMessage.ocr_status,
      review_items_created:
        Number(reviewRows?.length ?? 0),
      order_items_created:
        Number(itemCountAfter ?? 0),
      recovery_pending_image:
        remainingImage,
      recovery_pending_total:
        remainingTotal,
      result,
      webhook:
        "KEEP_OFF",
    });

  } catch (error) {
    console.error(
      "incident single-image recovery failed",
      error,
    );

    return json({
      ok: false,
      error:
        error?.message ?? String(error),
    }, 500);
  }
}

export const config = {
  path:
    "/api/incident-recovery-image-one",
  region: "sin",
};
