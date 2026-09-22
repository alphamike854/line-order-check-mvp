import {
  fetchOpenSettlementSession,
  json,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  buildExportPreparationLineMessages,
} from "../../src/lib/export-preparation-line-message.mjs";

import {
  pushExportPreparationToLine,
} from "../../src/lib/export-preparation-line-transport.mjs";

import {
  normalizeExportSendRequest,
} from "../../src/lib/export-preparation-send-request.mjs";


function rpcStatus(
  message,
) {
  if (
    message.includes(
      "EXPORT_DELIVERY_BUSY",
    )
    || message.includes(
      "EXPORT_TRANSPORT_STALE_AVAILABILITY",
    )
    || message.includes(
      "EXPORT_PREPARATION_STALE_ROUND",
    )
    || message.includes(
      "EXPORT_CYCLE_NOT_READY",
    )
    || message.includes(
      "EXPORT_DELIVERY_PAYLOAD_CONFLICT",
    )
    || message.includes(
      "EXPORT_DELIVERY_RETRY_WINDOW_EXPIRED",
    )
    || message.includes(
      "EXPORT_DELIVERY_TERMINAL_FAILURE",
    )
  ) {
    return 409;
  }

  if (
    message.includes(
      "NOT_FOUND",
    )
  ) {
    return 404;
  }

  if (
    message.includes(
      "EXPORT_"
    )
  ) {
    return 400;
  }

  return 500;
}


async function recordNonAccepted({
  cycleId,
  roundId,
  leaseToken,
  result,
  transport,
}) {
  return supabase.rpc(
    "record_export_preparation_delivery_result",
    {
      p_cycle_id:
        cycleId,

      p_expected_summary_group_round_id:
        roundId,

      p_lease_token:
        leaseToken,

      p_result:
        result,

      p_http_status:
        transport.http_status,

      p_line_request_id:
        transport.line_request_id,

      p_error:
        transport.response_text,
    },
  );
}


export default async function handler(req) {
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

  const denied =
    requireDashboardAccess(req);

  if (denied) {
    return denied;
  }


  /*
   * Fail before creating a transport reservation when no
   * LINE credential is available.
   */
  const channelAccessToken =
    String(
      process.env.LINE_CHANNEL_ACCESS_TOKEN
      ?? "",
    ).trim();

  if (!channelAccessToken) {
    return json(
      {
        ok: false,
        error:
          "LINE_CHANNEL_ACCESS_TOKEN_MISSING",
      },
      503,
    );
  }


  try {
    const url =
      new URL(req.url);

    const summaryGroupId =
      normalizeSummaryGroup(
        url.searchParams.get(
          "group",
        ),
      );

    if (!summaryGroupId) {
      return json(
        {
          ok: false,
          error:
            "SUMMARY_GROUP_REQUIRED",
        },
        400,
      );
    }


    let rawBody;

    try {
      rawBody =
        await req.json();
    } catch {
      return json(
        {
          ok: false,
          error:
            "INVALID_REQUEST_BODY",
        },
        400,
      );
    }


    let request;

    try {
      request =
        normalizeExportSendRequest(
          rawBody,
        );
    } catch (error) {
      return json(
        {
          ok: false,
          error:
            error?.message
            ?? "INVALID_REQUEST_BODY",
        },
        400,
      );
    }


    const session =
      await fetchOpenSettlementSession();

    if (!session) {
      return json(
        {
          ok: false,
          error:
            "SETTLEMENT_NOT_OPEN",
        },
        409,
      );
    }


    const {
      data: round,
      error: roundError,
    } =
      await supabase
        .from(
          "settlement_summary_group_rounds",
        )
        .select(
          [
            "id",
            "round_no",
            "daily_round_no",
            "summary_group_id",
            "status",
          ].join(","),
        )
        .eq(
          "settlement_session_id",
          session.id,
        )
        .eq(
          "summary_group_id",
          summaryGroupId,
        )
        .eq(
          "status",
          "OPEN",
        )
        .order(
          "round_no",
          {
            ascending: false,
          },
        )
        .limit(1)
        .maybeSingle();


    if (roundError) {
      throw roundError;
    }

    if (!round) {
      return json(
        {
          ok: false,
          error:
            "SUMMARY_GROUP_ROUND_NOT_OPEN",
        },
        409,
      );
    }

    if (
      round.id
      !== request.round_id
    ) {
      return json(
        {
          ok: false,
          error:
            "EXPORT_PREPARATION_STALE_ROUND",
          current_round_id:
            round.id,
        },
        409,
      );
    }


    /*
     * Browser cannot provide the destination, quantities,
     * or LINE payload.
     */
    const [
      cycleResult,
      itemResult,
    ] =
      await Promise.all([
        supabase
          .from(
            "settlement_export_cycles",
          )
          .select(
            [
              "id",
              "summary_group_round_id",
              "cycle_no",
              "status",
              "destination_line_group_id",
            ].join(","),
          )
          .eq(
            "id",
            request.cycle_id,
          )
          .maybeSingle(),

        supabase
          .from(
            "settlement_export_items",
          )
          .select(
            [
              "category",
              "code",
              "selected_send_quantity",
            ].join(","),
          )
          .eq(
            "cycle_id",
            request.cycle_id,
          )
          .order("category")
          .order("code"),
      ]);


    if (cycleResult.error) {
      throw cycleResult.error;
    }

    if (itemResult.error) {
      throw itemResult.error;
    }


    const cycle =
      cycleResult.data;

    if (!cycle) {
      return json(
        {
          ok: false,
          error:
            "EXPORT_CYCLE_NOT_FOUND",
        },
        404,
      );
    }


    if (
      cycle.summary_group_round_id
      !== round.id
    ) {
      return json(
        {
          ok: false,
          error:
            "EXPORT_PREPARATION_STALE_ROUND",
        },
        409,
      );
    }


    const messages =
      buildExportPreparationLineMessages({
        summaryGroupId,

        cycleNo:
          cycle.cycle_no,

        items:
          itemResult.data ?? [],
      });


    /*
     * Atomic pre-send revalidation + reservation.
     */
    const {
      data: begin,
      error: beginError,
    } =
      await supabase.rpc(
        "begin_export_preparation_delivery",
        {
          p_cycle_id:
            cycle.id,

          p_expected_summary_group_round_id:
            round.id,

          p_messages:
            messages,

          p_operator:
            "DASHBOARD",
        },
      );


    if (beginError) {
      const message =
        beginError?.message
        ?? String(beginError);

      return json(
        {
          ok: false,
          error:
            message,
        },
        rpcStatus(message),
      );
    }


    if (
      !begin
      || begin.ok !== true
      || !begin.delivery
    ) {
      throw new Error(
        "EXPORT_DELIVERY_BEGIN_RESPONSE_INVALID",
      );
    }


    if (
      begin.send_needed
      === false
    ) {
      return json({
        ok: true,

        mode:
          "EXPORT_PREPARATION_SEND",

        transport:
          "ALREADY_ACKNOWLEDGED",

        cycle_id:
          cycle.id,

        delivery:
          begin.delivery,
      });
    }


    const leaseToken =
      String(
        begin.lease_token
        ?? "",
      );

    const delivery =
      begin.delivery;


    /*
     * This is the only external transport call.
     */
    const transport =
      await pushExportPreparationToLine({
        channelAccessToken,

        destinationLineGroupId:
          delivery.destination_line_group_id,

        messages:
          delivery.messages,

        retryKey:
          delivery.line_retry_key,
      });


    /*
     * Positive acceptance:
     *
     * 2xx, or a retry-key 409 carrying
     * x-line-accepted-request-id.
     */
    if (
      transport.classification
        === "ACCEPTED"
      || transport.classification
        === "ALREADY_ACCEPTED"
    ) {

      const {
        data: completed,
        error: completeError,
      } =
        await supabase.rpc(
          "complete_export_preparation_delivery",
          {
            p_cycle_id:
              cycle.id,

            p_expected_summary_group_round_id:
              round.id,

            p_lease_token:
              leaseToken,

            p_http_status:
              transport.http_status,

            p_line_request_id:
              transport.line_request_id,

            p_line_accepted_request_id:
              transport.line_accepted_request_id,

            p_sent_by:
              "DASHBOARD",
          },
        );


      if (completeError) {
        /*
         * Do not downgrade to FAILED here.
         *
         * LINE may already have accepted the message.
         * The reservation stays SENDING so a future retry
         * reuses the same retry key and can reconcile via
         * LINE's 409 accepted response.
         */
        console.error(
          "LINE accepted but SENT accounting completion failed",
          completeError,
        );

        return json(
          {
            ok: false,

            error:
              "EXPORT_DELIVERY_ACK_ACCOUNTING_PENDING",

            transport,
          },
          500,
        );
      }


      return json({
        ok: true,

        mode:
          "EXPORT_PREPARATION_SEND",

        transport:
          transport.classification,

        cycle:
          completed?.cycle,

        delivery:
          completed?.delivery,

        items:
          completed?.items,
      });
    }


    const dbResult =
      transport.classification
        === "AMBIGUOUS"
          ? "AMBIGUOUS"
          : transport.classification
              === "RETRYABLE"
                ? "RETRYABLE"
                : "FAILED";


    const {
      error: recordError,
    } =
      await recordNonAccepted({
        cycleId:
          cycle.id,

        roundId:
          round.id,

        leaseToken,

        result:
          dbResult,

        transport,
      });


    if (recordError) {
      /*
       * Fail closed.
       *
       * The existing SENDING lease/reservation remains.
       */
      console.error(
        "Unable to record LINE transport result",
        recordError,
      );
    }


    const status =
      transport.classification
        === "AMBIGUOUS"
          ? 504
          : transport.classification
              === "RETRYABLE"
                ? 502
                : 422;


    return json(
      {
        ok: false,

        error:
          `LINE_${transport.classification}`,

        transport,
      },
      status,
    );


  } catch (error) {
    console.error(
      "export-preparation-send failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error?.message
          ?? String(error),
      },
      500,
    );
  }
}


export const config = {
  path:
    "/api/export-preparation-send",
};
