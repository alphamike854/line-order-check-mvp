import {
  json,
  normalizeSummaryGroup,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
} from "../../src/lib/staff-access.mjs";

import {
  loadActorSessionLineGroupIds,
} from "../../src/lib/staff-workbench.mjs";

import {
  loadDashboardRoundContext,
} from "../../src/lib/dashboard-round-context.mjs";


function elapsed(startedAt) {
  return Date.now() - startedAt;
}


export default async function handler(req) {
  if (req.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  const totalStartedAt = Date.now();

  const timings = {};

  try {
    const url =
      new URL(req.url);

    const sessionId =
      String(
        url.searchParams.get(
          "session_id",
        )
        ?? "",
      ).trim();

    const summaryGroupId =
      normalizeSummaryGroup(
        url.searchParams.get(
          "group",
        ),
      );

    if (!sessionId) {
      return json(
        {
          ok: false,
          error: "SESSION_ID_REQUIRED",
        },
        400,
      );
    }

    // --------------------------------------------------------
    // 1. Staff authentication
    // --------------------------------------------------------
    let startedAt =
      Date.now();

    const auth =
      await authenticateWorkbenchActor(
        req,
        {
          client: supabase,
        },
      );

    timings.auth_ms =
      elapsed(startedAt);

    if (!auth.ok) {
      return json(
        {
          ok: false,
          error: auth.error,
          timings,
        },
        auth.status,
      );
    }

    // --------------------------------------------------------
    // 2. Session lookup
    // --------------------------------------------------------
    startedAt =
      Date.now();

    const {
      data: session,
      error: sessionError,
    } = await supabase
      .from("settlement_sessions")
      .select(
        "id,business_date,status,opened_at,closed_at",
      )
      .eq(
        "id",
        sessionId,
      )
      .maybeSingle();

    timings.session_ms =
      elapsed(startedAt);

    if (sessionError) {
      throw sessionError;
    }

    if (!session) {
      return json(
        {
          ok: false,
          error: "SETTLEMENT_NOT_FOUND",
          timings,
        },
        404,
      );
    }

    // --------------------------------------------------------
    // 3. Staff LINE Group scope
    // --------------------------------------------------------
    startedAt =
      Date.now();

    const lineGroupIds =
      await loadActorSessionLineGroupIds(
        supabase,
        auth.actor,
        session.id,
      );

    timings.scope_ms =
      elapsed(startedAt);

    // --------------------------------------------------------
    // 4. Historical/current Round context
    // --------------------------------------------------------
    startedAt =
      Date.now();

    const roundContext =
      await loadDashboardRoundContext({
        supabase,
        settlementSessionId:
          session.id,
        summaryGroupId,
      });

    timings.round_context_ms =
      elapsed(startedAt);

    const roundIds =
      roundContext?.roundIds
      ?? [];

    // --------------------------------------------------------
    // 5. Accounting summary RPC
    // --------------------------------------------------------
    startedAt =
      Date.now();

    let query =
      supabase.rpc(
        "accounting_report_line_group_summary_rounds",
        {
          p_session_id:
            session.id,
          p_round_ids:
            roundIds,
          p_summary_group_id:
            summaryGroupId,
        },
      );

    if (
      auth.actor?.kind === "STAFF"
    ) {
      if (!lineGroupIds.length) {
        timings.summary_rpc_ms = 0;
        timings.total_ms =
          elapsed(totalStartedAt);

        return json({
          ok: true,
          actor_kind:
            auth.actor.kind,
          summary_group_id:
            summaryGroupId,
          line_group_count: 0,
          round_count:
            roundIds.length,
          summary_row_count: 0,
          timings,
        });
      }

      query =
        query.in(
          "line_group_id",
          lineGroupIds,
        );
    }

    const {
      data: summaryRows,
      error: summaryError,
    } = await query;

    timings.summary_rpc_ms =
      elapsed(startedAt);

    if (summaryError) {
      throw summaryError;
    }

    timings.total_ms =
      elapsed(totalStartedAt);

    return json({
      ok: true,

      actor_kind:
        auth.actor?.kind
        ?? null,

      summary_group_id:
        summaryGroupId,

      line_group_count:
        lineGroupIds.length,

      round_count:
        roundIds.length,

      summary_row_count:
        summaryRows?.length
        ?? 0,

      timings,
    });
  } catch (error) {
    timings.total_ms =
      elapsed(totalStartedAt);

    console.error(
      "staff-report-timing failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error?.message
          ?? String(error),
        timings,
      },
      500,
    );
  }
}


export const config = {
  path:
    "/api/staff-report-timing",
  region:
    "sin",
};
