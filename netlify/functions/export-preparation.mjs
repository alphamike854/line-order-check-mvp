import {
  fetchOpenSettlementSession,
  json,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  buildExportPreparationItems,
  summarizeExportPreparation,
} from "../../src/lib/export-preparation-read-model.mjs";


import {
  buildExportPreparationRiskAssessmentMap,
} from "../../src/lib/export-preparation-risk-band.mjs";

function validRiskSnapshot(value) {
  return (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Array.isArray(
      value.risk_codes,
    )
  );
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

    /*
     * Export Preparation is intentionally
     * Summary-Group scoped.
     *
     * ALL has no working-Round identity
     * and must never create a combined
     * export ledger.
     */
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
            "settlement_session_id",
            "summary_group_id",
            "round_no",
            "daily_round_no",
            "business_date",
            "status",
            "opened_at",
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
          summary_group_id:
            summaryGroupId,
        },
        409,
      );
    }

    const [
      riskResult,
      sentResult,
      cycleResult,
    ] =
      await Promise.all([
        supabase.rpc(
          "dashboard_risk_snapshot",
          {
            p_settlement_session_id:
              session.id,

            p_summary_group_id:
              summaryGroupId,
          },
        ),

        supabase
          .from(
            "settlement_export_sent_totals",
          )
          .select(
            [
              "category",
              "code",
              "sent_cumulative_quantity",
              "sent_cycle_count",
              "last_sent_at",
            ].join(","),
          )
          .eq(
            "summary_group_round_id",
            round.id,
          )
          .order("category")
          .order("code"),

        supabase
          .from(
            "settlement_export_cycles",
          )
          .select(
            [
              "id",
              "cycle_no",
              "status",
              "destination_line_group_id",
              "destination_label",
              "snapshot_at",
              "ready_at",
              "sent_at",
            ].join(","),
          )
          .eq(
            "summary_group_round_id",
            round.id,
          )
          .order(
            "cycle_no",
            {
              ascending: true,
            },
          ),
      ]);

    if (riskResult.error) {
      throw riskResult.error;
    }

    if (sentResult.error) {
      throw sentResult.error;
    }

    if (cycleResult.error) {
      throw cycleResult.error;
    }

    if (
      !validRiskSnapshot(
        riskResult.data,
      )
    ) {
      throw new Error(
        "RISK_SNAPSHOT_INVALID",
      );
    }

    const items =
      buildExportPreparationItems({
        summaryGroupId,

        riskCodes:
          riskResult
            .data
            .risk_codes,

        sentTotals:
          sentResult.data
          ?? [],
      });

    const riskAssessments =
      buildExportPreparationRiskAssessmentMap({
        summaryGroupId,

        riskCodes:
          riskResult
            .data
            .risk_codes
          ?? [],

        riskPools:
          riskResult
            .data
            .risk_pools
          ?? [],
        maxSimulationUnits:
          5000,

      });

    for (const item of items) {
      const category =
        String(
          item?.category || "",
        )
          .trim()
          .toUpperCase();

      const code =
        String(
          item?.code || "",
        ).trim();

      const assessment =
        riskAssessments.get(
          `${category}|${code}`,
        )
        ?? {
          risk_band:
            "UNKNOWN",
          recommended_transfer:
            0,
        };

      const current =
        Math.max(
          0,
          Number(
            item?.current_effective_quantity
            || 0,
          ),
        );

      const sent =
        Math.max(
          0,
          Number(
            item?.sent_cumulative_quantity
            || 0,
          ),
        );

      const overCeiling =
        Math.max(
          0,
          Number(
            assessment
              ?.recommended_transfer
            || 0,
          ),
        );

      item.risk_band =
        assessment?.risk_band
        ?? "UNKNOWN";

      /*
       * Operator-facing quantities:
       *
       * over_ceiling_quantity
       *   canonical configured-tolerance
       *   Risk Engine recommendation.
       *
       * export_remaining_quantity
       *   what still needs to be exported
       *   after same-Round SENT quantities.
       *
       * order_remaining_quantity
       *   current active order after SENT.
       */
      item.over_ceiling_quantity =
        overCeiling;

      item.export_remaining_quantity =
        Math.max(
          overCeiling - sent,
          0,
        );

      item.order_remaining_quantity =
        Math.max(
          current - sent,
          0,
        );
    }

    const totals =
      summarizeExportPreparation(
        items,
      );

    totals.over_ceiling_quantity =
      items.reduce(
        (sum, item) =>
          sum
          + Number(
            item?.over_ceiling_quantity
            || 0,
          ),
        0,
      );

    totals.export_remaining_quantity =
      items.reduce(
        (sum, item) =>
          sum
          + Number(
            item?.export_remaining_quantity
            || 0,
          ),
        0,
      );

    totals.order_remaining_quantity =
      items.reduce(
        (sum, item) =>
          sum
          + Number(
            item?.order_remaining_quantity
            || 0,
          ),
        0,
      );

    const cycles =
      cycleResult.data
      ?? [];

    return json({
      ok: true,

      mode:
        "EXPORT_PREPARATION_READ_ONLY",

      generated_at:
        new Date()
          .toISOString(),

      settlement_session: {
        id:
          session.id,

        business_date:
          session.business_date,

        status:
          session.status,
      },

      summary_group_id:
        summaryGroupId,

      round,

      totals,

      items,

      cycles,

      cycle_summary: {
        cycle_count:
          cycles.length,

        sent_cycle_count:
          cycles.filter(
            (row) =>
              row.status
              === "SENT",
          ).length,

        draft_cycle_count:
          cycles.filter(
            (row) =>
              row.status
              === "DRAFT",
          ).length,

        ready_cycle_count:
          cycles.filter(
            (row) =>
              row.status
              === "READY",
          ).length,
      },
    });
  } catch (error) {
    console.error(
      "export-preparation failed",
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
    "/api/export-preparation",
};
