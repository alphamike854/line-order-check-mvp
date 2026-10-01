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
  EAST: {
    text: 8,
    image: 5,
  },
  SOUTH: {
    text: 228,
    image: 117,
  },
  SOUTHEAST: {
    text: 404,
    image: 68,
  },
  SOUTHWEST: {
    text: 3,
    image: 7,
  },
};


function fail(message, status = 409) {
  return json({
    ok: false,
    error: message,
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

  if (body?.action !== "CANARY_5_TEXT") {
    return fail("INVALID_ACTION", 400);
  }

  try {
    // --------------------------------------------------------
    // 1. Live-round guard.
    // Exactly NORTH + WEST may be OPEN.
    // --------------------------------------------------------

    const {
      data: openRounds,
      error: openError,
    } = await supabase
      .from("settlement_summary_group_rounds")
      .select(
        "id,summary_group_id,round_no,business_date,status"
      )
      .eq("status", "OPEN");

    if (openError) throw openError;

    if ((openRounds ?? []).length !== 2) {
      return fail(
        `EXPECTED_2_OPEN_ROUNDS_FOUND_${
          openRounds?.length ?? 0
        }`,
      );
    }

    const openGroups =
      (openRounds ?? [])
        .map((row) => row.summary_group_id)
        .sort();

    if (
      openGroups.join(",")
      !== "NORTH,WEST"
    ) {
      return fail(
        `UNEXPECTED_OPEN_GROUPS_${openGroups.join("_")}`,
      );
    }


    // --------------------------------------------------------
    // 2. Resolve the four exact historical recovery rounds.
    // --------------------------------------------------------

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
          EXPECTED_ROUNDS.get(
            row.summary_group_id,
          ) === Number(row.round_no),
      );

    if (recoveryRounds.length !== 4) {
      return fail(
        `EXPECTED_4_RECOVERY_ROUNDS_FOUND_${
          recoveryRounds.length
        }`,
      );
    }

    const roundIds =
      recoveryRounds.map((row) => row.id);


    // --------------------------------------------------------
    // 3. Locate the atomic 840-row skeleton batch.
    // --------------------------------------------------------

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
      .in(
        "summary_group_round_id",
        roundIds,
      )
      .order(
        "created_at",
        { ascending: false },
      )
      .limit(1000);

    if (messageError) throw messageError;

    const byCreatedAt = new Map();

    for (const row of recentMessages ?? []) {
      const rows =
        byCreatedAt.get(row.created_at) ?? [];

      rows.push(row);

      byCreatedAt.set(
        row.created_at,
        rows,
      );
    }

    const batches =
      [...byCreatedAt.entries()]
        .filter(
          ([, rows]) => rows.length === 840,
        )
        .sort(
          ([a], [b]) =>
            new Date(b).getTime()
            - new Date(a).getTime(),
        );

    if (!batches.length) {
      return fail(
        "RECOVERY_BATCH_840_NOT_FOUND",
      );
    }

    const [
      batchCreatedAt,
      batch,
    ] = batches[0];


    // --------------------------------------------------------
    // 4. Batch must still be pristine before first canary.
    // --------------------------------------------------------

    const pending =
      batch.filter(
        (row) =>
          row.parse_status === "PENDING",
      );

    if (pending.length !== 840) {
      return fail(
        `EXPECTED_840_PENDING_FOUND_${
          pending.length
        }`,
      );
    }

    const actual = {};

    for (const row of batch) {
      actual[row.summary_group_id] ??= {
        text: 0,
        image: 0,
      };

      if (
        row.message_type === "text"
        || row.message_type === "image"
      ) {
        actual[row.summary_group_id][
          row.message_type
        ]++;
      }
    }

    for (
      const [
        group,
        expected,
      ] of Object.entries(EXPECTED_BATCH)
    ) {
      const observed =
        actual[group] ?? {
          text: 0,
          image: 0,
        };

      if (
        observed.text !== expected.text
        || observed.image !== expected.image
      ) {
        return fail(
          `BATCH_COMPOSITION_MISMATCH_${group}`,
        );
      }
    }


    // --------------------------------------------------------
    // 5. Select deterministic five TEXT canaries only.
    // --------------------------------------------------------

    const canaries =
      batch
        .filter(
          (row) =>
            row.message_type === "text"
            && row.parse_status === "PENDING",
        )
        .sort(
          (a, b) =>
            new Date(
              a.event_timestamp,
            ).getTime()
            - new Date(
              b.event_timestamp,
            ).getTime()
            || String(
              a.webhook_event_id,
            ).localeCompare(
              String(
                b.webhook_event_id,
              ),
            ),
        )
        .slice(0, 5);

    if (canaries.length !== 5) {
      return fail(
        `EXPECTED_5_CANARIES_FOUND_${
          canaries.length
        }`,
      );
    }

    const eventIds =
      canaries.map(
        (row) => row.webhook_event_id,
      );

    const messageIds =
      canaries.map(
        (row) => row.id,
      );


    // --------------------------------------------------------
    // 6. Canary rows must have no canonical items yet.
    // --------------------------------------------------------

    const {
      count: itemCountBefore,
      error: itemBeforeError,
    } = await supabase
      .from("order_items")
      .select(
        "id",
        {
          count: "exact",
          head: true,
        },
      )
      .in(
        "message_record_id",
        messageIds,
      );

    if (itemBeforeError) {
      throw itemBeforeError;
    }

    if (
      Number(
        itemCountBefore ?? 0,
      ) !== 0
    ) {
      return fail(
        `CANARY_ALREADY_HAS_ORDER_ITEMS_${
          itemCountBefore
        }`,
      );
    }


    // --------------------------------------------------------
    // 7. Exact webhook events must be reclaim-ready.
    // --------------------------------------------------------

    const {
      data: eventRows,
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
      .in(
        "webhook_event_id",
        eventIds,
      );

    if (eventError) throw eventError;

    if (
      (eventRows ?? []).length !== 5
    ) {
      return fail(
        `EXPECTED_5_WEBHOOK_EVENTS_FOUND_${
          eventRows?.length ?? 0
        }`,
      );
    }

    const eventsById =
      new Map(
        eventRows.map(
          (row) => [
            row.webhook_event_id,
            row,
          ],
        ),
      );

    for (const canary of canaries) {
      const event =
        eventsById.get(
          canary.webhook_event_id,
        );

      if (!event) {
        return fail(
          "CANARY_WEBHOOK_EVENT_MISSING",
        );
      }

      if (
        event.processed_at !== null
        || event.processing_started_at
          !== null
      ) {
        return fail(
          "CANARY_NOT_RECLAIM_READY",
        );
      }
    }


    // --------------------------------------------------------
    // 8. Process sequentially. No parallel fan-out.
    // --------------------------------------------------------

    const results = [];

    for (
      let index = 0;
      index < canaries.length;
      index++
    ) {
      const canary =
        canaries[index];

      const event =
        eventsById.get(
          canary.webhook_event_id,
        );

      try {
        const result =
          await processEvent(
            event.destination,
            event.payload,
          );

        results.push({
          index: index + 1,
          summary_group_id:
            canary.summary_group_id,
          result,
        });
      } catch (error) {
        return json({
          ok: false,
          error:
            "CANARY_PROCESSING_FAILED",
          completed:
            results.length,
          failed_index:
            index + 1,
          failed_group:
            canary.summary_group_id,
          detail:
            error?.message
            ?? String(error),
          results,
        }, 500);
      }
    }


    // --------------------------------------------------------
    // 9. Verify the five webhook events completed.
    // --------------------------------------------------------

    const {
      data: afterEvents,
      error: afterEventError,
    } = await supabase
      .from("webhook_events")
      .select(
        "webhook_event_id,processed_at,processing_started_at,last_error,attempt_count"
      )
      .in(
        "webhook_event_id",
        eventIds,
      );

    if (afterEventError) {
      throw afterEventError;
    }

    const badEvents =
      (afterEvents ?? []).filter(
        (row) =>
          !row.processed_at
          || row.processing_started_at
            !== null
          || row.last_error !== null,
      );

    if (badEvents.length) {
      return fail(
        `CANARY_WEBHOOK_VERIFY_FAILED_${
          badEvents.length
        }`,
        500,
      );
    }


    // --------------------------------------------------------
    // 10. Verify message statuses moved off PENDING.
    // --------------------------------------------------------

    const {
      data: afterMessages,
      error: afterMessageError,
    } = await supabase
      .from("messages")
      .select(
        "id,summary_group_id,parse_status,parser_version"
      )
      .in(
        "id",
        messageIds,
      );

    if (afterMessageError) {
      throw afterMessageError;
    }

    const stillPending =
      (afterMessages ?? []).filter(
        (row) =>
          row.parse_status === "PENDING",
      );

    if (stillPending.length) {
      return fail(
        `CANARY_STILL_PENDING_${
          stillPending.length
        }`,
        500,
      );
    }


    const {
      count: itemCountAfter,
      error: itemAfterError,
    } = await supabase
      .from("order_items")
      .select(
        "id",
        {
          count: "exact",
          head: true,
        },
      )
      .in(
        "message_record_id",
        messageIds,
      );

    if (itemAfterError) {
      throw itemAfterError;
    }


    const {
      count: remainingPending,
      error: remainingError,
    } = await supabase
      .from("messages")
      .select(
        "id",
        {
          count: "exact",
          head: true,
        },
      )
      .eq(
        "created_at",
        batchCreatedAt,
      )
      .in(
        "summary_group_round_id",
        roundIds,
      )
      .eq(
        "parse_status",
        "PENDING",
      );

    if (remainingError) {
      throw remainingError;
    }


    const statusCounts = {};

    for (
      const row
      of afterMessages ?? []
    ) {
      statusCounts[
        row.parse_status
      ] =
        (
          statusCounts[
            row.parse_status
          ] ?? 0
        ) + 1;
    }


    return json({
      ok: true,
      action:
        "CANARY_5_TEXT",
      processed: 5,
      results,
      statuses:
        statusCounts,
      order_items_created:
        Number(
          itemCountAfter ?? 0,
        ),
      recovery_pending_remaining:
        Number(
          remainingPending ?? 0,
        ),
      batch_created_at:
        batchCreatedAt,
      webhook:
        "KEEP_OFF",
    });

  } catch (error) {
    console.error(
      "incident recovery canary failed",
      error,
    );

    return json({
      ok: false,
      error:
        error?.message
        ?? String(error),
    }, 500);
  }
}


export const config = {
  path:
    "/api/incident-recovery-canary",
  region: "sin",
};
