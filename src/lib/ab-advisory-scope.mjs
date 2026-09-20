import {
  buildSharedAbRiskPlan,
  summarizeAbRows,
} from "./ab-risk-advisory.mjs";

const AB =
  new Set(["A", "B"]);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(
    (num(value) + Number.EPSILON) * 100
  ) / 100;
}

function abRows(rows = []) {
  return rows.filter(
    (row) => AB.has(row?.category)
  );
}

function maxExposure(
  rows,
  category
) {
  return round2(
    Math.max(
      0,
      ...rows
        .filter(
          row =>
            row.category === category
        )
        .map(
          row =>
            num(row.retained_quantity)
            *
            num(row.effective_multiplier)
        )
    )
  );
}

function retainedTotal(
  rows,
  category
) {
  return rows
    .filter(
      row => row.category === category
    )
    .reduce(
      (sum, row) =>
        sum + num(row.retained_quantity),
      0
    );
}

function lineMetrics({
  rows,
  summaryPlan,
} = {}) {
  const summary =
    summarizeAbRows(rows);

  const capA =
    summaryPlan?.A
      ?.common_retention_limit
      ?? null;

  const capB =
    summaryPlan?.B
      ?.common_retention_limit
      ?? null;

  const overCapA =
    capA == null
      ? null
      : rows.filter(
          row =>
            row.category === "A"
            &&
            num(row.retained_quantity)
              > capA
        ).length;

  const overCapB =
    capB == null
      ? null
      : rows.filter(
          row =>
            row.category === "B"
            &&
            num(row.retained_quantity)
              > capB
        ).length;

  return {
    gross_received:
      round2(
        summary.A.gross
        + summary.B.gross
      ),

    adjusted_received:
      round2(
        summary.A.adjusted
        + summary.B.adjusted
      ),

    A: {
      gross_received:
        summary.A.gross,

      adjusted_received:
        summary.A.adjusted,

      retained_quantity:
        retainedTotal(rows, "A"),

      point_reserve:
        maxExposure(rows, "A"),

      summary_retention_cap:
        capA,

      codes_over_summary_cap:
        overCapA,
    },

    B: {
      gross_received:
        summary.B.gross,

      adjusted_received:
        summary.B.adjusted,

      retained_quantity:
        retainedTotal(rows, "B"),

      point_reserve:
        maxExposure(rows, "B"),

      summary_retention_cap:
        capB,

      codes_over_summary_cap:
        overCapB,
    },
  };
}

/*
 * Important contract:
 *
 * SUMMARY GROUP
 *   = authoritative risk decision.
 *
 * LINE GROUP
 *   = visibility / attribution only.
 *
 * LINE Groups do NOT receive an independent
 * Shared Max Loss budget.
 */
export function buildAbAdvisoryScopes({
  summaryRows = [],
  lineGroupRows = [],
  sharedMaxLoss = 200000,
} = {}) {
  const summarySource =
    abRows(summaryRows);

  const lineSource =
    abRows(lineGroupRows);

  const summaryIds =
    [
      ...new Set(
        summarySource
          .map(
            row =>
              String(
                row.summary_group_id ?? ""
              ).trim()
          )
          .filter(Boolean)
      ),
    ].sort();

  const summaryGroups = [];
  const lineGroups = [];

  for (
    const summaryGroupId
    of summaryIds
  ) {
    const scopedSummaryRows =
      summarySource.filter(
        row =>
          String(row.summary_group_id)
          === summaryGroupId
      );

    let plan = null;
    let status = "READY";
    let error = null;

    try {
      plan =
        buildSharedAbRiskPlan({
          rows: scopedSummaryRows,
          sharedMaxLoss,
        });
    } catch (cause) {
      status = "NOT_READY";
      error =
        cause?.message
        ?? String(cause);
    }

    summaryGroups.push({
      summary_group_id:
        summaryGroupId,

      decision_role:
        "AUTHORITATIVE",

      calculation_status:
        status,

      calculation_error:
        error,

      plan,
    });

    const scopedLineRows =
      lineSource.filter(
        row =>
          String(row.summary_group_id)
          === summaryGroupId
      );

    const lineIds =
      [
        ...new Set(
          scopedLineRows
            .map(
              row =>
                String(
                  row.line_group_id ?? ""
                ).trim()
            )
            .filter(Boolean)
        ),
      ].sort();

    for (
      const lineGroupId
      of lineIds
    ) {
      const rows =
        scopedLineRows.filter(
          row =>
            String(row.line_group_id)
            === lineGroupId
        );

      let metrics = null;
      let lineStatus = "READY";
      let lineError = null;

      try {
        metrics =
          lineMetrics({
            rows,
            summaryPlan: plan,
          });
      } catch (cause) {
        lineStatus = "NOT_READY";
        lineError =
          cause?.message
          ?? String(cause);
      }

      lineGroups.push({
        summary_group_id:
          summaryGroupId,

        line_group_id:
          lineGroupId,

        line_group_name:
          rows.find(
            row => row.line_group_name
          )?.line_group_name
          ?? null,

        decision_role:
          "ATTRIBUTION_ONLY",

        calculation_status:
          lineStatus,

        calculation_error:
          lineError,

        metrics,
      });
    }
  }

  return {
    shared_max_loss:
      Number(sharedMaxLoss),

    summary_groups:
      summaryGroups,

    line_groups:
      lineGroups,
  };
}
