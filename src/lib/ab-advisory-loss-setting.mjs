const DEFAULT_AB_SHARED_MAX_LOSS = 200000;

function round2(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 100
  ) / 100;
}

export function resolveAbSharedMaxLoss({
  rows = [],
  summaryGroupId = "",
  fallback = DEFAULT_AB_SHARED_MAX_LOSS,
} = {}) {
  const fallbackValue = Number(fallback);

  if (
    !Number.isFinite(fallbackValue)
    || fallbackValue < 0
  ) {
    throw new Error(
      "AB_SHARED_MAX_LOSS_FALLBACK_INVALID"
    );
  }

  const targetGroup =
    String(summaryGroupId || "").trim();

  const row = Array.isArray(rows)
    ? rows.find(
        item =>
          String(
            item?.summary_group_id || ""
          ) === targetGroup
          && String(
            item?.risk_pool || "MAIN"
          ).toUpperCase() === "MAIN"
      )
    : null;

  /*
   * An existing MAIN setting is authoritative,
   * including an explicit zero.
   *
   * Missing MAIN configuration retains the
   * historical 200,000 fallback.
   *
   * Invalid persisted configuration must fail
   * closed instead of silently expanding the
   * accepted loss budget.
   */
  if (!row) {
    return {
      shared_max_loss: round2(fallbackValue),
      source: "FALLBACK_200000",
    };
  }

  const configured =
    Number(row.point_loss_tolerance);

  if (
    !Number.isFinite(configured)
    || configured < 0
  ) {
    throw new Error(
      "AB_SHARED_MAX_LOSS_CONFIG_INVALID"
    );
  }

  return {
    shared_max_loss: round2(configured),
    source: "MAIN_POINT_LOSS_TOLERANCE",
  };
}

export {
  DEFAULT_AB_SHARED_MAX_LOSS,
};
