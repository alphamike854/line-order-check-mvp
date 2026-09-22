import {
  fetchOpenSettlementSession,
  json,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  normalizeExportDraftRequest,
} from "../../src/lib/export-preparation-draft-request.mjs";

function statusForRpcError(
  message,
) {
  if (
    message.includes(
      "EXPORT_QUANTITY_EXCEEDS_AVAILABLE",
    )
    || message.includes(
      "EXPORT_ROUND_NOT_OPEN",
    )
    || message.includes(
      "EXPORT_CLIENT_REQUEST_CONFLICT",
    )
  ) {
    return 409;
  }

  if (
    message.includes(
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
        normalizeExportDraftRequest(
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
     * Server resolves the authoritative current Round.
     *
     * Browser round_id is only an expected/stale guard.
     * It never chooses the DB Round by itself.
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
        "create_export_preparation_draft",
        {
          p_summary_group_round_id:
            round.id,

          p_client_request_id:
            request.client_request_id,

          p_items:
            request.items,

          p_created_by:
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
          error: message,
        },
        statusForRpcError(
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
        "EXPORT_DRAFT_RESPONSE_INVALID",
      );
    }

    return json(
      {
        ok: true,

        mode:
          "EXPORT_PREPARATION_DRAFT",

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

        created:
          data.created
          === true,

        idempotent_replay:
          data.idempotent_replay
          === true,

        cycle:
          data.cycle,

        items:
          data.items,
      },
      data.created === true
        ? 201
        : 200,
    );

  } catch (error) {
    console.error(
      "export-preparation-draft failed",
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
    "/api/export-preparation-draft",
};
