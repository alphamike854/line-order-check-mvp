import {
  json,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  buildAbAdvisoryScopes,
} from "../../src/lib/ab-advisory-scope.mjs";

import {
  DEFAULT_AB_SHARED_MAX_LOSS,
  resolveAbSharedMaxLoss,
} from "../../src/lib/ab-advisory-loss-setting.mjs";


function validRiskSnapshot(value) {
  return (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Array.isArray(
      value.risk_codes,
    )
    && Array.isArray(
      value.line_group_risk_codes,
    )
  );
}


function emptyAdvisory(
  sharedMaxLoss =
    DEFAULT_AB_SHARED_MAX_LOSS,
) {
  return {
    calculation_status:
      "READY",

    calculation_error:
      null,

    shared_max_loss:
      sharedMaxLoss,

    summary_groups: [],
    line_groups: [],
  };
}


export default async function handler(req) {
  if (req.method !== "GET") {
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


    /*
     * Read-only calculation scope.
     *
     * Latest Summary-Group Round may be OPEN or CLOSED
     * and may belong to an OPEN or CLOSED Settlement.
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
            "business_date",
            "status",
            "opened_at",
            "closed_at",
          ].join(","),
        )
        .eq(
          "summary_group_id",
          summaryGroupId,
        )
        .in(
          "status",
          [
            "OPEN",
            "CLOSED",
          ],
        )
        .order(
          "business_date",
          {
            ascending: false,
          },
        )
        .order(
          "opened_at",
          {
            ascending: false,
          },
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
      return json({
        ok: true,

        mode:
          "AB_ADVISORY_PREVIEW_READ_ONLY",

        generated_at:
          new Date()
            .toISOString(),

        summary_group_id:
          summaryGroupId,

        round:
          null,

        ab_advisory:
          emptyAdvisory(),
      });
    }


    const [
      riskResult,
      riskBudgetResult,
    ] =
      await Promise.all([
        supabase.rpc(
          "dashboard_risk_snapshot",
          {
            p_settlement_session_id:
              round
                .settlement_session_id,

            p_summary_group_id:
              summaryGroupId,
          },
        ),

        supabase
          .from(
            "summary_group_risk_pool_settings",
          )
          .select(
            [
              "summary_group_id",
              "risk_pool",
              "point_loss_tolerance",
            ].join(","),
          )
          .eq(
            "summary_group_id",
            summaryGroupId,
          )
          .eq(
            "risk_pool",
            "MAIN",
          ),
      ]);

    if (riskResult.error) {
      throw riskResult.error;
    }

    if (riskBudgetResult.error) {
      throw riskBudgetResult.error;
    }

    if (
      !validRiskSnapshot(
        riskResult.data,
      )
    ) {
      throw new Error(
        "DASHBOARD_RISK_SNAPSHOT_INVALID",
      );
    }


    const loss =
      resolveAbSharedMaxLoss({
        rows:
          riskBudgetResult.data
          ?? [],

        summaryGroupId,

        fallback:
          DEFAULT_AB_SHARED_MAX_LOSS,
      });


    let abAdvisory;

    try {
      const scopes =
        buildAbAdvisoryScopes({
          summaryRows:
            riskResult
              .data
              .risk_codes
            ?? [],

          lineGroupRows:
            riskResult
              .data
              .line_group_risk_codes
            ?? [],

          sharedMaxLoss:
            loss.shared_max_loss,
        });

      const hasNotReady =
        scopes.summary_groups.some(
          row =>
            row.calculation_status
            !== "READY",
        );

      abAdvisory = {
        calculation_status:
          hasNotReady
            ? "PARTIAL"
            : "READY",

        calculation_error:
          null,

        shared_max_loss:
          loss.shared_max_loss,

        shared_max_loss_source:
          loss.source,

        ...scopes,
      };
    } catch (error) {
      abAdvisory = {
        calculation_status:
          "ERROR",

        calculation_error:
          error?.message
          ?? String(error),

        shared_max_loss:
          loss.shared_max_loss,

        shared_max_loss_source:
          loss.source,

        summary_groups: [],
        line_groups: [],
      };
    }


    return json({
      ok: true,

      mode:
        "AB_ADVISORY_PREVIEW_READ_ONLY",

      generated_at:
        new Date()
          .toISOString(),

      summary_group_id:
        summaryGroupId,

      round: {
        id:
          round.id,

        settlement_session_id:
          round.settlement_session_id,

        summary_group_id:
          round.summary_group_id,

        round_no:
          round.round_no,

        daily_round_no:
          round.daily_round_no,

        business_date:
          round.business_date,

        status:
          round.status,

        opened_at:
          round.opened_at,

        closed_at:
          round.closed_at,
      },

      ab_advisory:
        abAdvisory,
    });

  } catch (error) {
    console.error(
      "ab-advisory-preview failed",
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
    "/api/ab-advisory-preview",
};
