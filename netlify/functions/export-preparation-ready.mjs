import {
  fetchOpenSettlementSession,
  json,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  normalizeExportReadyRequest,
} from "../../src/lib/export-preparation-ready-request.mjs";


function statusForReadyError(
  message,
) {
  if (
    message.includes(
      "EXPORT_PREPARATION_STALE_ROUND",
    )
    || message.includes(
      "EXPORT_ROUND_NOT_OPEN",
    )
    || message.includes(
      "EXPORT_DRAFT_STALE_AVAILABILITY",
    )
    || message.includes(
      "EXPORT_READY_DESTINATION_CONFLICT",
    )
    || message.includes(
      "EXPORT_CYCLE_ALREADY_SENT",
    )
    || message.includes(
      "EXPORT_CYCLE_NOT_DRAFT",
    )
  ) {
    return 409;
  }

  if (
    message.includes(
      "EXPORT_CYCLE_NOT_FOUND",
    )
    || message.includes(
      "EXPORT_ROUND_NOT_FOUND",
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
        normalizeExportReadyRequest(
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


    /*
     * Resolve authoritative current OPEN Round.
     * Browser round_id is stale protection only.
     */
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
            "settlement_session_id",
            "summary_group_id",
            "round_no",
            "daily_round_no",
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


    const {
      data,
      error,
    } =
      await supabase.rpc(
        "mark_export_preparation_ready",
        {
          p_cycle_id:
            request.cycle_id,

          p_expected_summary_group_round_id:
            round.id,

          p_destination_line_group_id:
            request.destination_line_group_id,

          p_destination_label:
            request.destination_label,

          p_ready_by:
            "DASHBOARD",
        },
      );


    if (error) {

      const message =
        error?.message
        ?? String(error);

      return json(
        {
          ok: false,
          error:
            message,
        },
        statusForReadyError(
          message,
        ),
      );

    }


    if (
      !data
      || data.ok !== true
      || !data.cycle
      || !Array.isArray(
        data.items,
      )
    ) {
      throw new Error(
        "EXPORT_READY_RESPONSE_INVALID",
      );
    }


    return json({
      ok: true,

      mode:
        "EXPORT_PREPARATION_READY",

      summary_group_id:
        summaryGroupId,

      round: {
        id:
          round.id,

        round_no:
          round.round_no,

        daily_round_no:
          round.daily_round_no,

        status:
          round.status,
      },

      changed:
        data.changed
        === true,

      idempotent_replay:
        data.idempotent_replay
        === true,

      cycle:
        data.cycle,

      items:
        data.items,
    });


  } catch (error) {

    console.error(
      "export-preparation-ready failed",
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
    "/api/export-preparation-ready",
};
