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

  const configured =
    Number(row?.point_loss_tolerance);

  /*
   * Current persisted data contains 0 / missing rows.
   *
   * Until configuration has an explicit
   * "configured/enabled" state, zero is treated
   * as UNCONFIGURED for A/B advisory so that
   * existing production behaviour remains safe.
   */
  if (
    Number.isFinite(configured)
    && configured > 0
  ) {
    return {
      shared_max_loss: round2(configured),
      source: "MAIN_POINT_LOSS_TOLERANCE",
    };
  }

  return {
    shared_max_loss: round2(fallbackValue),
    source: "FALLBACK_200000",
  };
}

export {
  DEFAULT_AB_SHARED_MAX_LOSS,
};
