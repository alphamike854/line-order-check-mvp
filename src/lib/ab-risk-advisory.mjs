function round2(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 100
  ) / 100;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRows(rows = []) {
  return rows
    .filter((row) =>
      row?.category === "A" ||
      row?.category === "B"
    )
    .map((row) => {
      const retained = num(row.retained_quantity);

      if (
        retained < 0 ||
        !Number.isInteger(retained)
      ) {
        throw new Error(
          "AB_RETAINED_QUANTITY_INVALID"
        );
      }

      const multiplier =
        num(row.effective_multiplier);

      if (retained > 0 && multiplier <= 0) {
        throw new Error(
          "AB_EFFECTIVE_MULTIPLIER_REQUIRED"
        );
      }

      const maxSpecial =
        Math.max(
          1,
          Math.trunc(
            num(row.max_special_codes, 1)
          )
        );

      if (maxSpecial !== 1) {
        throw new Error(
          "AB_FAST_PLANNER_REQUIRES_MAX_SPECIAL_CODES_1"
        );
      }

      return {
        ...row,
        category: String(row.category),
        code: String(row.code ?? "").padStart(2, "0"),
        retained_quantity: retained,
        effective_multiplier: multiplier,
        order_total: num(row.order_total),
        adjusted_total: num(row.adjusted_total),
        max_special_codes: maxSpecial,
      };
    });
}

function pointExposure(quantity, multiplier) {
  return round2(
    num(quantity) * num(multiplier)
  );
}

function maxRetainedWithinBudget(
  riskBudget,
  multiplier
) {
  const budget = num(riskBudget);
  const mult = num(multiplier);

  if (mult <= 0) return 0;

  let q = Math.max(
    0,
    Math.floor(budget / mult)
  );

  while (
    pointExposure(q + 1, mult)
      <= budget + 1e-9
  ) {
    q += 1;
  }

  while (
    q > 0 &&
    pointExposure(q, mult)
      > budget + 1e-9
  ) {
    q -= 1;
  }

  return q;
}

export function summarizeAbRows(rows = []) {
  const normalized = normalizeRows(rows);

  const result = {
    A: {
      gross: 0,
      adjusted: 0,
      retained: 0,
    },
    B: {
      gross: 0,
      adjusted: 0,
      retained: 0,
    },
  };

  for (const row of normalized) {
    const x = result[row.category];

    x.gross += row.order_total;
    x.adjusted += row.adjusted_total;
    x.retained += row.retained_quantity;
  }

  for (const category of ["A", "B"]) {
    result[category].gross =
      round2(result[category].gross);

    result[category].adjusted =
      round2(result[category].adjusted);
  }

  return result;
}

export function buildFastAbCategoryPlan({
  rows = [],
  category,
  adjustedTotal = 0,
  lossTolerance = 0,
} = {}) {
  if (category !== "A" && category !== "B") {
    throw new Error(
      "AB_CATEGORY_REQUIRED"
    );
  }

  const normalized =
    normalizeRows(rows)
      .filter(
        (row) => row.category === category
      );

  const adjusted =
    round2(adjustedTotal);

  const tolerance =
    round2(lossTolerance);

  if (adjusted < 0 || tolerance < 0) {
    throw new Error(
      "AB_RISK_INPUT_INVALID"
    );
  }

  const riskBudget =
    round2(adjusted + tolerance);

  const beforeReserve =
    round2(
      Math.max(
        0,
        ...normalized.map(
          (row) =>
            pointExposure(
              row.retained_quantity,
              row.effective_multiplier
            )
        )
      )
    );

  const projected = normalized.map((row) => {
    const retentionLimit =
      maxRetainedWithinBudget(
        riskBudget,
        row.effective_multiplier
      );

    const projectedRetained =
      Math.min(
        row.retained_quantity,
        retentionLimit
      );

    const recommendedTransfer =
      row.retained_quantity
      - projectedRetained;

    return {
      category: row.category,
      code: row.code,
      retained_before:
        row.retained_quantity,
      retention_limit:
        retentionLimit,
      projected_retained:
        projectedRetained,
      recommended_transfer:
        recommendedTransfer,
      effective_multiplier:
        row.effective_multiplier,
      point_exposure_before:
        pointExposure(
          row.retained_quantity,
          row.effective_multiplier
        ),
      point_exposure_after:
        pointExposure(
          projectedRetained,
          row.effective_multiplier
        ),
    };
  });

  const afterReserve =
    round2(
      Math.max(
        0,
        ...projected.map(
          (row) =>
            row.point_exposure_after
        )
      )
    );

  const recommendations =
    projected
      .filter(
        (row) =>
          row.recommended_transfer > 0
      )
      .sort(
        (a, b) =>
          b.recommended_transfer
          - a.recommended_transfer
          ||
          a.code.localeCompare(b.code)
      );

  const limits =
    [
      ...new Set(
        projected
          .filter(
            (row) =>
              row.effective_multiplier > 0
          )
          .map(
            (row) =>
              row.retention_limit
          )
      ),
    ].sort((a, b) => a - b);

  return {
    category,
    adjusted_received: adjusted,
    point_loss_tolerance: tolerance,
    risk_budget: riskBudget,

    point_reserve_before:
      beforeReserve,

    point_reserve_after_plan:
      afterReserve,

    worst_case_loss:
      round2(
        afterReserve - adjusted
      ),

    transfer_required_total:
      recommendations.reduce(
        (sum, row) =>
          sum
          + row.recommended_transfer,
        0
      ),

    common_retention_limit:
      limits.length === 1
        ? limits[0]
        : null,

    retention_limit_min:
      limits.length
        ? limits[0]
        : null,

    retention_limit_max:
      limits.length
        ? limits[limits.length - 1]
        : null,

    recommendations,
  };
}

export function buildSharedAbRiskPlan({
  rows = [],
  sharedMaxLoss = 200000,
} = {}) {
  const normalized =
    normalizeRows(rows);

  const summary =
    summarizeAbRows(normalized);

  const adjustedA =
    summary.A.adjusted;

  const adjustedB =
    summary.B.adjusted;

  const adjustedTotal =
    round2(adjustedA + adjustedB);

  const maxLoss =
    round2(sharedMaxLoss);

  if (maxLoss < 0) {
    throw new Error(
      "AB_SHARED_MAX_LOSS_INVALID"
    );
  }

  if (adjustedTotal <= 0) {
    throw new Error(
      "AB_ADJUSTED_TOTAL_REQUIRED"
    );
  }

  const lossA =
    round2(
      maxLoss
      * adjustedA
      / adjustedTotal
    );

  const lossB =
    round2(maxLoss - lossA);

  const A =
    buildFastAbCategoryPlan({
      rows: normalized,
      category: "A",
      adjustedTotal: adjustedA,
      lossTolerance: lossA,
    });

  const B =
    buildFastAbCategoryPlan({
      rows: normalized,
      category: "B",
      adjustedTotal: adjustedB,
      lossTolerance: lossB,
    });

  const worstCaseLoss =
    round2(
      A.worst_case_loss
      + B.worst_case_loss
    );

  return {
    shared_max_loss: maxLoss,

    gross_received:
      round2(
        summary.A.gross
        + summary.B.gross
      ),

    adjusted_received:
      adjustedTotal,

    loss_budget: {
      A: lossA,
      B: lossB,
      total:
        round2(lossA + lossB),
    },

    A,
    B,

    transfer_required_total:
      A.transfer_required_total
      + B.transfer_required_total,

    worst_case_loss:
      worstCaseLoss,

    loss_headroom:
      round2(
        maxLoss - worstCaseLoss
      ),

    guard_pass:
      worstCaseLoss
      <= maxLoss + 1e-9,
  };
}

export function buildAbBatchAdvisory({
  plan,
  batchLimit,
  finalRound = false,
} = {}) {
  const limit =
    Math.trunc(num(batchLimit));

  if (limit <= 0) {
    throw new Error(
      "AB_BATCH_LIMIT_INVALID"
    );
  }

  const rows = [];

  for (const category of ["A", "B"]) {
    for (
      const rec
      of plan?.[category]
        ?.recommendations || []
    ) {
      const required =
        Math.trunc(
          num(rec.recommended_transfer)
        );

      if (required <= 0) continue;

      /*
       * Normal rounds:
       *   only emit a full batch.
       *
       * Examples for batchLimit=500:
       *   116 -> 0
       *   499 -> 0
       *   500 -> 500
       *   3824 -> 500
       *
       * Final round:
       *   emit the whole remaining requirement.
       */
      const quantity =
        finalRound
          ? required
          : (
              required >= limit
                ? limit
                : 0
            );

      if (quantity <= 0) continue;

      rows.push({
        category,
        code: rec.code,
        quantity,
        required_total:
          required,
      });
    }
  }

  return {
    batch_limit: limit,
    final_round:
      Boolean(finalRound),
    rows,
    total_quantity:
      rows.reduce(
        (sum, row) =>
          sum + row.quantity,
        0
      ),
  };
}

function fmt(value) {
  return Math.round(num(value))
    .toLocaleString("en-US");
}

function capLabel(plan) {
  if (
    plan.common_retention_limit
    !== null
  ) {
    return fmt(
      plan.common_retention_limit
    );
  }

  if (
    plan.retention_limit_min
      === null
    ||
    plan.retention_limit_max
      === null
  ) {
    return "-";
  }

  return (
    `${fmt(plan.retention_limit_min)}`
    + "-"
    + `${fmt(plan.retention_limit_max)}`
  );
}

function operationalText(rows = []) {
  const byCode = new Map();

  for (const row of rows) {
    const code =
      String(row.code).padStart(2, "0");

    if (!byCode.has(code)) {
      byCode.set(
        code,
        { A: 0, B: 0 }
      );
    }

    byCode.get(code)[row.category] +=
      Math.trunc(num(row.quantity));
  }

  const onlyA = [];
  const onlyB = [];
  const both = [];

  const codes =
    [...byCode.keys()]
      .sort(
        (a, b) =>
          Number(a) - Number(b)
          ||
          a.localeCompare(b)
      );

  for (const code of codes) {
    const x = byCode.get(code);

    if (x.A > 0 && x.B > 0) {
      both.push(
        `${code}=${x.A}x${x.B}`
      );
    } else if (x.A > 0) {
      onlyA.push(
        `${code}=${x.A}`
      );
    } else if (x.B > 0) {
      onlyB.push(
        `${code}=${x.B}`
      );
    }
  }

  const sections = [];

  if (onlyA.length) {
    sections.push(
      `บ\n${onlyA.join("\n")}`
    );
  }

  if (onlyB.length) {
    sections.push(
      `ล\n${onlyB.join("\n")}`
    );
  }

  if (both.length) {
    sections.push(
      `บล\n${both.join("\n")}`
    );
  }

  return sections.join("\n\n");
}

export function formatAbAdvisoryBubbles({
  summaryGroup,
  time,
  reductionPct,
  plan,
  batch,
} = {}) {
  const pct =
    Number.isFinite(
      Number(reductionPct)
    )
      ? ` ${Number(reductionPct)}%`
      : "";

  const bubble1 = [
    `${summaryGroup} | ${time}`,
    "",
    `ยอดรวม ${fmt(plan.gross_received)}`,
    `ยอดหลังหัก${pct} ${fmt(plan.adjusted_received)}`,
    "",
    "เพดาน/รหัส",
    `บ ${capLabel(plan.A)}`,
    `ล ${capLabel(plan.B)}`,
  ].join("\n");

  const bubble2 =
    operationalText(
      batch?.rows || []
    );

  return {
    bubble1,
    bubble2,
  };
}
