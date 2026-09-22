function nonNegativeSafeInteger(
  value,
  label,
) {
  const number =
    Number(
      value ?? 0,
    );

  if (
    !Number.isSafeInteger(number)
    || number < 0
  ) {
    throw new Error(
      `INVALID_${label}`,
    );
  }

  return number;
}

function optionalNumber(value) {
  if (
    value === null
    || value === undefined
    || value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function identity(row) {
  const category =
    String(
      row?.category ?? "",
    ).trim();

  const code =
    String(
      row?.code ?? "",
    ).trim();

  if (
    !category
    || !code
  ) {
    throw new Error(
      "INVALID_EXPORT_CODE_IDENTITY",
    );
  }

  return {
    category,
    code,
    key:
      `${category}\u0000${code}`,
  };
}

/*
 * Export Preparation read model.
 *
 * Important:
 * - Current truth comes from the current Summary Group risk snapshot.
 * - Export truth comes ONLY from SENT cycles of the same Round.
 * - DRAFT / READY do not reduce availability.
 * - If current truth falls below prior SENT because of UNSEND/correction,
 *   availability becomes zero and reconciliation_required is surfaced.
 */
export function buildExportPreparationItems({
  summaryGroupId,
  riskCodes = [],
  sentTotals = [],
}) {
  const safeSummaryGroupId =
    String(
      summaryGroupId ?? "",
    ).trim();

  if (!safeSummaryGroupId) {
    throw new Error(
      "SUMMARY_GROUP_REQUIRED",
    );
  }

  if (!Array.isArray(riskCodes)) {
    throw new Error(
      "INVALID_RISK_CODES",
    );
  }

  if (!Array.isArray(sentTotals)) {
    throw new Error(
      "INVALID_SENT_TOTALS",
    );
  }

  const currentByCode =
    new Map();

  for (const row of riskCodes) {
    if (
      String(
        row?.summary_group_id ?? "",
      ) !== safeSummaryGroupId
    ) {
      continue;
    }

    const id =
      identity(row);

    if (
      currentByCode.has(
        id.key,
      )
    ) {
      throw new Error(
        "DUPLICATE_CURRENT_CODE",
      );
    }

    const currentEffectiveQuantity =
      nonNegativeSafeInteger(
        row.order_total,
        "CURRENT_EFFECTIVE_QUANTITY",
      );

    currentByCode.set(
      id.key,
      {
        category:
          id.category,

        code:
          id.code,

        current_effective_quantity:
          currentEffectiveQuantity,

        risk_context: {
          adjusted_total:
            optionalNumber(
              row.adjusted_total,
            ),

          effective_multiplier:
            optionalNumber(
              row.effective_multiplier,
            ),

          point_exposure:
            optionalNumber(
              row.point_exposure,
            ),

          confirmed_cut:
            optionalNumber(
              row.confirmed_cut,
            ),

          available_to_cut:
            optionalNumber(
              row.available_to_cut,
            ),

          retained_quantity:
            optionalNumber(
              row.retained_quantity,
            ),
        },
      },
    );
  }

  const sentByCode =
    new Map();

  for (const row of sentTotals) {
    const id =
      identity(row);

    if (
      sentByCode.has(
        id.key,
      )
    ) {
      throw new Error(
        "DUPLICATE_SENT_TOTAL",
      );
    }

    sentByCode.set(
      id.key,
      {
        category:
          id.category,

        code:
          id.code,

        sent_cumulative_quantity:
          nonNegativeSafeInteger(
            row.sent_cumulative_quantity,
            "SENT_CUMULATIVE_QUANTITY",
          ),

        sent_cycle_count:
          nonNegativeSafeInteger(
            row.sent_cycle_count,
            "SENT_CYCLE_COUNT",
          ),

        last_sent_at:
          row.last_sent_at
          ?? null,
      },
    );
  }

  const keys =
    new Set([
      ...currentByCode.keys(),
      ...sentByCode.keys(),
    ]);

  const items =
    [];

  for (const key of keys) {
    const current =
      currentByCode.get(key);

    const sent =
      sentByCode.get(key);

    const category =
      current?.category
      ?? sent?.category;

    const code =
      current?.code
      ?? sent?.code;

    const currentQuantity =
      current
        ?.current_effective_quantity
      ?? 0;

    const sentQuantity =
      sent
        ?.sent_cumulative_quantity
      ?? 0;

    const availableQuantity =
      Math.max(
        currentQuantity
        - sentQuantity,
        0,
      );

    const overSentQuantity =
      Math.max(
        sentQuantity
        - currentQuantity,
        0,
      );

    if (
      currentQuantity === 0
      && sentQuantity === 0
    ) {
      continue;
    }

    items.push({
      summary_group_id:
        safeSummaryGroupId,

      category,
      code,

      current_effective_quantity:
        currentQuantity,

      sent_cumulative_quantity:
        sentQuantity,

      available_quantity:
        availableQuantity,

      over_sent_quantity:
        overSentQuantity,

      reconciliation_required:
        overSentQuantity > 0,

      selectable:
        availableQuantity > 0,

      sent_cycle_count:
        sent
          ?.sent_cycle_count
        ?? 0,

      last_sent_at:
        sent
          ?.last_sent_at
        ?? null,

      risk_context:
        current
          ?.risk_context
        ?? null,
    });
  }

  return items.sort(
    (a, b) =>
      a.category.localeCompare(
        b.category,
      )
      || a.code.localeCompare(
        b.code,
        undefined,
        {
          numeric: true,
        },
      ),
  );
}

export function summarizeExportPreparation(
  items,
) {
  if (!Array.isArray(items)) {
    throw new Error(
      "INVALID_EXPORT_ITEMS",
    );
  }

  return items.reduce(
    (summary, item) => {
      summary.current_effective_quantity +=
        item.current_effective_quantity;

      summary.sent_cumulative_quantity +=
        item.sent_cumulative_quantity;

      summary.available_quantity +=
        item.available_quantity;

      summary.over_sent_quantity +=
        item.over_sent_quantity;

      if (item.selectable) {
        summary.selectable_code_count +=
          1;
      }

      if (
        item.reconciliation_required
      ) {
        summary.reconciliation_required_count +=
          1;
      }

      return summary;
    },
    {
      code_count:
        items.length,

      selectable_code_count:
        0,

      reconciliation_required_count:
        0,

      current_effective_quantity:
        0,

      sent_cumulative_quantity:
        0,

      available_quantity:
        0,

      over_sent_quantity:
        0,
    },
  );
}
