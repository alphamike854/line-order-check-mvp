import {
  buildRiskDistributionPlan,
} from "./risk-engine.mjs";


function normalizePool(value) {
  const pool =
    String(value || "MAIN")
      .trim()
      .toUpperCase();

  return ["MAIN", "H", "L"].includes(pool)
    ? pool
    : "MAIN";
}


function poolForCategory(category) {
  const value =
    String(category || "")
      .trim()
      .toUpperCase();

  if (value === "H") return "H";
  if (value === "L") return "L";

  return "MAIN";
}


function recommendationMap(plan) {
  return new Map(
    (plan?.recommendations || []).map(
      (row) => [
        `${
          String(row?.category || "")
            .trim()
            .toUpperCase()
        }|${String(row?.code || "").trim()}`,
        Number(
          row?.recommended_transfer || 0,
        ),
      ],
    ),
  );
}


export function buildExportPreparationRiskAssessmentMap({
  summaryGroupId,
  riskCodes = [],
  riskPools = [],
  maxSimulationUnits = 200000,
} = {}) {
  const group =
    String(summaryGroupId || "").trim();

  const result =
    new Map();

  const rows =
    (Array.isArray(riskCodes)
      ? riskCodes
      : []
    ).filter(
      (row) =>
        String(
          row?.summary_group_id || "",
        ).trim() === group,
    );

  for (const row of rows) {
    const category =
      String(row?.category || "")
        .trim()
        .toUpperCase();

    const code =
      String(row?.code || "").trim();

    if (!category || !code) continue;

    result.set(
      `${category}|${code}`,
      {
        risk_band: "UNKNOWN",
        recommended_transfer: 0,
      },
    );
  }

  for (
    const poolName
    of ["MAIN", "H", "L"]
  ) {
    const poolRows =
      rows.filter(
        (row) =>
          poolForCategory(
            row?.category,
          ) === poolName,
      );

    if (!poolRows.length) {
      continue;
    }

    const pool =
      (Array.isArray(riskPools)
        ? riskPools
        : []
      ).find(
        (row) =>
          String(
            row?.summary_group_id || "",
          ).trim() === group
          && normalizePool(
            row?.risk_pool,
          ) === poolName,
      );

    if (
      !pool
      || pool?.multiplier_configured === false
    ) {
      continue;
    }

    const adjustedTotal =
      Number(
        pool?.adjusted_received || 0,
      );

    const tolerance =
      Math.max(
        0,
        Number(
          pool?.point_loss_tolerance || 0,
        ),
      );

    let zeroPlan;
    let tolerancePlan;

    try {
      zeroPlan =
        buildRiskDistributionPlan({
          rows:
            poolRows,

          adjustedTotal,

          pointLossTolerance:
            0,

          maxSimulationUnits:
            Number(maxSimulationUnits),
        });

      tolerancePlan =
        buildRiskDistributionPlan({
          rows:
            poolRows,

          adjustedTotal,

          pointLossTolerance:
            tolerance,

          maxSimulationUnits:
            Number(maxSimulationUnits),
        });
    } catch {
      continue;
    }

    const zeroRecommendations =
      recommendationMap(
        zeroPlan,
      );

    const toleranceRecommendations =
      recommendationMap(
        tolerancePlan,
      );

    for (const row of poolRows) {
      const category =
        String(row?.category || "")
          .trim()
          .toUpperCase();

      const code =
        String(row?.code || "")
          .trim();

      const key =
        `${category}|${code}`;

      const retained =
        Math.max(
          0,
          Number(
            row?.retained_quantity
            ?? row?.order_total
            ?? 0,
          ),
        );

      if (retained <= 0) {
        result.set(
          key,
          {
            risk_band: "GREEN",
            recommended_transfer: 0,
          },
        );

        continue;
      }

      const aboveAcceptedCeiling =
        Math.max(
          0,
          Number(
            toleranceRecommendations
              .get(key)
            || 0,
          ),
        );

      const aboveZeroProfit =
        Math.max(
          0,
          Number(
            zeroRecommendations
              .get(key)
            || 0,
          ),
        );

      /*
       * GREEN
       * ไม่ต้องลดแม้ tolerance = 0
       *
       * YELLOW
       * เกินกำไร 0 แต่ยังอยู่ในเพดานยอมเสีย
       *
       * RED
       * ยังต้องลดแม้ใช้เพดานยอมเสียแล้ว
       *
       * recommended_transfer
       * คือจำนวน canonical ที่เกินเพดานยอมเสียจริง
       */
      const riskBand =
        aboveAcceptedCeiling > 0
          ? "RED"
          : aboveZeroProfit > 0
            ? "YELLOW"
            : "GREEN";

      result.set(
        key,
        {
          risk_band:
            riskBand,

          recommended_transfer:
            Math.min(
              retained,
              aboveAcceptedCeiling,
            ),
        },
      );
    }
  }

  return result;
}


export function buildExportPreparationRiskBandMap(
  options = {},
) {
  const assessments =
    buildExportPreparationRiskAssessmentMap(
      options,
    );

  return new Map(
    [...assessments.entries()].map(
      ([key, assessment]) => [
        key,
        assessment?.risk_band
        || "UNKNOWN",
      ],
    ),
  );
}
