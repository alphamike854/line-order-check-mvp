// Legacy/safety fallbacks only.
// Company Point multipliers must come from point_category_profiles /
// settlement_point_profiles. In particular, H/L remain zero here so a
// missing configuration can never invent a company multiplier.
export const DEFAULT_POINT_PROFILES = Object.freeze({
  A: { multiplier: 14, max_special_codes: 1 },
  B: { multiplier: 14, max_special_codes: 1 },
  E: { multiplier: 100, max_special_codes: 1 },
  F: { multiplier: 20, max_special_codes: 6 },
  G: { multiplier: 20, max_special_codes: 4 },
  H: { multiplier: 0, max_special_codes: 3 },
  L: { multiplier: 0, max_special_codes: 2 },
});

export const DEFAULT_RISK_BAND_SIZE = 100000;

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}


export function calculateLineGroupRiskBand({
  grossReceived = 0,
  reductionPct = 0,
  bandSize = DEFAULT_RISK_BAND_SIZE,
} = {}) {
  const gross = Number(grossReceived);
  const reduction = Number(reductionPct);
  const size = Number(bandSize);

  if (!Number.isFinite(gross) || gross < 0) {
    throw new Error("INVALID_LINE_GROUP_GROSS_RECEIVED");
  }

  if (!Number.isFinite(reduction) || reduction < 0 || reduction > 100) {
    throw new Error("INVALID_LINE_GROUP_REDUCTION_PCT");
  }

  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("INVALID_RISK_BAND_SIZE");
  }

  const calculationBand = Math.floor(gross / size) * size;
  const riskBudgetPct = round2(100 - reduction);
  const riskBudget = round2(
    calculationBand * riskBudgetPct / 100,
  );

  const nextBand = calculationBand > 0
    ? calculationBand + size
    : size;

  return {
    gross_received: round2(gross),
    calculation_band: calculationBand,
    reduction_pct: round2(reduction),
    risk_budget_pct: riskBudgetPct,
    risk_budget: riskBudget,
    calculation_status:
      calculationBand > 0
        ? "READY"
        : "WAITING_FIRST_BAND",
    amount_to_next_band: round2(
      Math.max(0, nextBand - gross),
    ),
  };
}

export function effectiveMultiplier(multiplier, promotionFactorPct = 100) {
  const base = Number(multiplier || 0);
  const factor = Number(promotionFactorPct ?? 100);
  if (!Number.isFinite(base) || base < 0) throw new Error("INVALID_POINT_MULTIPLIER");
  if (!Number.isFinite(factor) || factor < 0 || factor > 100) throw new Error("INVALID_PROMOTION_FACTOR");
  return round2(base * factor / 100);
}


export function categoryRiskBudgetDivisor(
  category,
  maxSpecialCodes = 1,
) {
  const normalizedCategory = String(category || "").trim().toUpperCase();
  const maxCodes = Number(maxSpecialCodes);

  if (!["A", "B", "E", "F", "G", "H", "L"].includes(normalizedCategory)) {
    throw new Error("INVALID_RISK_CATEGORY");
  }

  if (!Number.isSafeInteger(maxCodes) || maxCodes <= 0) {
    throw new Error("INVALID_MAX_SPECIAL_CODES");
  }

  // A and B share one two-digit risk budget:
  // one A code + one B code may hit the same Point.
  if (normalizedCategory === "A" || normalizedCategory === "B") {
    return 2;
  }

  // Other categories divide their category budget across the maximum
  // number of codes that may hit the same Point.
  return maxCodes;
}


export function calculateCategoryRetentionLimit({
  category,
  riskBudget = 0,
  multiplier = 0,
  maxSpecialCodes = 1,
  promotionFactorPct = 100,
} = {}) {
  const budget = Number(riskBudget);
  const effective = effectiveMultiplier(
    multiplier,
    promotionFactorPct,
  );

  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error("INVALID_RISK_BUDGET");
  }

  if (!(effective > 0)) {
    throw new Error("POINT_MULTIPLIER_NOT_CONFIGURED");
  }

  const divisor = categoryRiskBudgetDivisor(
    category,
    maxSpecialCodes,
  );

  return Math.floor(
    budget / effective / divisor,
  );
}


export function calculateCodeRetentionRecommendation({
  category,
  quantity = 0,
  riskBudget = 0,
  multiplier = 0,
  maxSpecialCodes = 1,
  promotionFactorPct = 100,
} = {}) {
  const qty = Number(quantity);

  if (!Number.isSafeInteger(qty) || qty < 0) {
    throw new Error("INVALID_ORDER_QUANTITY");
  }

  const effective = effectiveMultiplier(
    multiplier,
    promotionFactorPct,
  );

  const retentionLimit = calculateCategoryRetentionLimit({
    category,
    riskBudget,
    multiplier,
    maxSpecialCodes,
    promotionFactorPct,
  });

  const projectedRetained = Math.min(
    qty,
    retentionLimit,
  );

  const recommendedCut = Math.max(
    0,
    qty - retentionLimit,
  );

  return {
    category: String(category || "").trim().toUpperCase(),
    quantity: qty,
    risk_budget: round2(riskBudget),
    effective_multiplier: effective,
    budget_divisor: categoryRiskBudgetDivisor(
      category,
      maxSpecialCodes,
    ),
    retention_limit: retentionLimit,
    recommended_cut: recommendedCut,
    projected_retained: projectedRetained,
    projected_point_exposure: round2(
      projectedRetained * effective,
    ),
    recommended_point_reduction: round2(
      recommendedCut * effective,
    ),
  };
}

export function pointExposure(quantity, multiplier, promotionFactorPct = 100) {
  return round2(Number(quantity || 0) * effectiveMultiplier(multiplier, promotionFactorPct));
}

export function selectReserveCandidates(rows = [], maxSpecialCodes = 1) {
  const limit = Math.max(0, Number(maxSpecialCodes || 0));
  return [...rows]
    .map((row) => ({
      ...row,
      exposure: pointExposure(row.quantity, row.multiplier, row.promotion_factor_pct ?? 100),
    }))
    .sort((a, b) => Number(b.exposure) - Number(a.exposure)
      || Number(b.quantity || 0) - Number(a.quantity || 0)
      || String(a.code).localeCompare(String(b.code)))
    .slice(0, limit);
}

export function categoryRiskMetrics({ adjustedTotal = 0, candidates = [], maxSpecialCodes = 1 } = {}) {
  const adjusted = round2(adjustedTotal);
  const selected = selectReserveCandidates(candidates, maxSpecialCodes);
  const reserve = round2(selected.reduce((sum, row) => sum + Number(row.exposure || 0), 0));
  const safe = round2(adjusted - reserve);
  const riskPct = adjusted > 0 ? round2(reserve / adjusted * 100) : (reserve > 0 ? 100 : 0);
  return { adjusted_total: adjusted, point_reserve: reserve, safe_capacity: safe, risk_pct: riskPct, reserve_candidates: selected };
}

function normalizeDistributionRows(rows = []) {
  return (rows || []).map((row) => {
    const category = String(row.category || "").toUpperCase();
    const code = String(row.code || "").trim();
    const retained = Math.max(0, Math.floor(Number(row.retained_quantity ?? row.available_to_cut ?? row.order_total ?? 0)));
    const multiplier = Number(row.effective_multiplier ?? row.multiplier ?? row.special_multiplier ?? 0);
    const maxSpecialCodes = Math.max(1, Math.floor(Number(row.max_special_codes || DEFAULT_POINT_PROFILES[category]?.max_special_codes || 1)));
    if (!DEFAULT_POINT_PROFILES[category] || !code || !Number.isFinite(multiplier) || multiplier < 0) return null;
    return {
      category,
      code,
      retained_quantity: retained,
      effective_multiplier: multiplier,
      max_special_codes: maxSpecialCodes,
      order_total: Number(row.order_total ?? retained),
      confirmed_cut: Number(row.confirmed_cut ?? Math.max(0, Number(row.order_total || 0) - retained)),
    };
  }).filter(Boolean);
}

export function retainedReserveSnapshot(rows = []) {
  const normalized = normalizeDistributionRows(rows);
  const categories = new Map();
  for (const row of normalized) {
    if (!categories.has(row.category)) categories.set(row.category, []);
    categories.get(row.category).push(row);
  }
  const selectedKeys = new Set();
  const categoryReserve = {};
  let reserve = 0;
  for (const [category, items] of categories.entries()) {
    const limit = Math.max(1, Number(items[0]?.max_special_codes || 1));
    const ranked = items
      .map((row) => ({ ...row, exposure: round2(row.retained_quantity * row.effective_multiplier) }))
      .sort((a, b) => b.exposure - a.exposure || b.retained_quantity - a.retained_quantity || a.code.localeCompare(b.code));
    const selected = ranked.filter((row) => row.retained_quantity > 0 && row.effective_multiplier > 0).slice(0, limit);
    const subtotal = round2(selected.reduce((sum, row) => sum + row.exposure, 0));
    categoryReserve[category] = subtotal;
    reserve = round2(reserve + subtotal);
    for (const row of selected) selectedKeys.add(`${row.category}|${row.code}`);
  }
  return { point_reserve: reserve, selected_keys: selectedKeys, category_reserve: categoryReserve, rows: normalized };
}

function distributionCategoryState(items = []) {
  const limit = Math.max(1, Number(items[0]?.max_special_codes || 1));
  const ranked = items
    .map((row) => ({ ...row, exposure: round2(row.retained_quantity * row.effective_multiplier) }))
    .sort((a, b) => b.exposure - a.exposure
      || b.retained_quantity - a.retained_quantity
      || a.code.localeCompare(b.code));
  const selected = ranked
    .filter((row) => row.retained_quantity > 0 && row.effective_multiplier > 0)
    .slice(0, limit);
  return {
    subtotal: round2(selected.reduce((sum, row) => sum + row.exposure, 0)),
    selected_keys: new Set(selected.map((row) => `${row.category}|${row.code}`)),
  };
}

function distributionReserveFromStates(categoryOrder = [], states = new Map(), overrideCategory = null, overrideState = null) {
  let reserve = 0;
  for (const category of categoryOrder) {
    const state = category === overrideCategory && overrideState ? overrideState : states.get(category);
    reserve = round2(reserve + Number(state?.subtotal || 0));
  }
  return reserve;
}

/**
 * Build a conservative operational distribution plan.
 *
 * The company keeps the original Received/Adjusted totals for accounting, but the
 * operational Point exposure uses only quantity still retained by our warehouse:
 *   retained = received - confirmed transfer out.
 *
 * Risk budget = adjusted received + accepted Point loss tolerance.
 * When worst-case retained Point reserve is above that budget, this simulation
 * removes one unit at a time from the currently worst-case candidates until the
 * reserve is within budget. Re-ranking after every unit is intentional: when a
 * top code is reduced, another code can become the new special-Point worst case.
 *
 * For dashboard performance, only the affected category is re-ranked while the
 * other category snapshots are reused. This preserves the unit-by-unit decision
 * policy without rebuilding and sorting the complete row set for every candidate.
 */
export function buildRiskDistributionPlan({ rows = [], adjustedTotal = 0, pointLossTolerance = 0, maxSimulationUnits = 200000 } = {}) {
  const adjusted = round2(adjustedTotal);
  const tolerance = round2(Math.max(0, Number(pointLossTolerance || 0)));
  const riskBudget = round2(adjusted + tolerance);
  const working = normalizeDistributionRows(rows).map((row) => ({ ...row }));
  const initial = retainedReserveSnapshot(working);
  let currentReserve = initial.point_reserve;
  const initialExcess = round2(Math.max(0, currentReserve - riskBudget));
  const recommendations = new Map();
  const categoryRows = new Map();
  for (const row of working) {
    if (!categoryRows.has(row.category)) categoryRows.set(row.category, []);
    categoryRows.get(row.category).push(row);
  }
  const categoryOrder = [...categoryRows.keys()];
  const categoryStates = new Map(categoryOrder.map((category) => [
    category,
    distributionCategoryState(categoryRows.get(category)),
  ]));
  let iterations = 0;

  while (currentReserve > riskBudget + 1e-9) {
    if (iterations >= maxSimulationUnits) throw new Error("RISK_DISTRIBUTION_SIMULATION_LIMIT");
    const candidates = working.filter((row) => row.retained_quantity > 0
      && categoryStates.get(row.category)?.selected_keys.has(`${row.category}|${row.code}`));
    if (!candidates.length) break;

    let best = null;
    for (const candidate of candidates) {
      candidate.retained_quantity -= 1;
      const afterCategory = distributionCategoryState(categoryRows.get(candidate.category));
      candidate.retained_quantity += 1;
      const after = distributionReserveFromStates(categoryOrder, categoryStates, candidate.category, afterCategory);
      const delta = round2(currentReserve - after);
      const exposure = round2(candidate.retained_quantity * candidate.effective_multiplier);
      const score = { candidate, after, delta, exposure };
      if (!best
        || score.delta > best.delta + 1e-9
        || (Math.abs(score.delta - best.delta) < 1e-9 && score.candidate.effective_multiplier > best.candidate.effective_multiplier)
        || (Math.abs(score.delta - best.delta) < 1e-9 && score.candidate.effective_multiplier === best.candidate.effective_multiplier && score.exposure > best.exposure)
        || (Math.abs(score.delta - best.delta) < 1e-9 && score.candidate.effective_multiplier === best.candidate.effective_multiplier && score.exposure === best.exposure && `${score.candidate.category}${score.candidate.code}` < `${best.candidate.category}${best.candidate.code}`)) {
        best = score;
      }
    }
    if (!best) break;
    best.candidate.retained_quantity -= 1;
    const key = `${best.candidate.category}|${best.candidate.code}`;
    recommendations.set(key, (recommendations.get(key) || 0) + 1);
    categoryStates.set(best.candidate.category, distributionCategoryState(categoryRows.get(best.candidate.category)));
    currentReserve = distributionReserveFromStates(categoryOrder, categoryStates);
    iterations += 1;
  }

  const final = retainedReserveSnapshot(working);
  const recommendationRows = [...recommendations.entries()].map(([key, quantity]) => {
    const [category, code] = key.split("|");
    const before = initial.rows.find((row) => row.category === category && row.code === code);
    const after = final.rows.find((row) => row.category === category && row.code === code);
    return {
      category,
      code,
      recommended_transfer: quantity,
      retained_before: before?.retained_quantity ?? 0,
      projected_retained: after?.retained_quantity ?? 0,
      effective_multiplier: before?.effective_multiplier ?? 0,
      point_reduction_estimate: round2(quantity * Number(before?.effective_multiplier || 0)),
      reserve_candidate_now: initial.selected_keys.has(key),
    };
  }).sort((a, b) => Number(b.reserve_candidate_now) - Number(a.reserve_candidate_now)
    || b.effective_multiplier - a.effective_multiplier
    || b.recommended_transfer - a.recommended_transfer
    || a.category.localeCompare(b.category)
    || a.code.localeCompare(b.code));

  return {
    adjusted_received: adjusted,
    point_loss_tolerance: tolerance,
    risk_budget: riskBudget,
    point_reserve_before: initial.point_reserve,
    point_reserve_after_plan: final.point_reserve,
    excess_point_risk_before: initialExcess,
    excess_point_risk_after_plan: round2(Math.max(0, final.point_reserve - riskBudget)),
    transfer_required_total: recommendationRows.reduce((sum, row) => sum + row.recommended_transfer, 0),
    recommendations: recommendationRows,
  };
}

export function projectRiskAfterTransfers({ rows = [], adjustedTotal = 0, pointLossTolerance = 0, items = [] } = {}) {
  const working = normalizeDistributionRows(rows).map((row) => ({ ...row }));
  const byKey = new Map(working.map((row) => [`${row.category}|${row.code}`, row]));
  for (const item of items || []) {
    const key = `${String(item.category || "").toUpperCase()}|${String(item.code || "").trim()}`;
    const row = byKey.get(key);
    const quantity = Number(item.quantity || 0);
    if (!row || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > row.retained_quantity) throw new Error("INVALID_TRANSFER_ITEM");
    row.retained_quantity -= quantity;
  }
  const adjusted = round2(adjustedTotal);
  const tolerance = round2(Math.max(0, Number(pointLossTolerance || 0)));
  const riskBudget = round2(adjusted + tolerance);
  const after = retainedReserveSnapshot(working);
  return {
    risk_budget: riskBudget,
    projected_point_reserve: after.point_reserve,
    projected_excess_point_risk: round2(Math.max(0, after.point_reserve - riskBudget)),
  };
}

export function overallRiskMetrics({ adjustedTotal = 0, pointReserve = 0, actualPoint = null, confirmedCut = 0, pointLossTolerance = 0 } = {}) {
  const adjusted = round2(adjustedTotal);
  const reserve = round2(pointReserve);
  const actual = actualPoint == null ? null : round2(actualPoint);
  const tolerance = round2(Math.max(0, Number(pointLossTolerance || 0)));
  const riskPoint = reserve;
  const mode = "RESERVE";
  const safetyMargin = round2(adjusted - riskPoint);
  const riskBudget = round2(adjusted + tolerance);
  const excess = round2(Math.max(0, riskPoint - riskBudget));
  const confirmed = round2(confirmedCut);
  const riskPct = adjusted > 0 ? round2(riskPoint / adjusted * 100) : (riskPoint > 0 ? 100 : 0);
  return {
    adjusted_total: adjusted,
    point_reserve: reserve,
    actual_point: actual,
    risk_point_total: riskPoint,
    risk_mode: mode,
    net_safe_capacity: safetyMargin,
    confirmed_cut_total: confirmed,
    remaining_safe_capacity: Math.max(0, safetyMargin),
    over_safe_amount: Math.max(0, -safetyMargin),
    risk_pct: riskPct,
    safety_margin: safetyMargin,
    safety_margin_pct: adjusted > 0 ? round2(safetyMargin / adjusted * 100) : 0,
    point_loss_tolerance: tolerance,
    risk_budget: riskBudget,
    risk_budget_margin: round2(riskBudget - riskPoint),
    excess_point_risk: excess,
  };
}

export function compactTransferLines(items = []) {
  const normalized = items
    .map((item) => ({ category: String(item.category || "").toUpperCase(), code: String(item.code || ""), quantity: Number(item.quantity || 0) }))
    .filter((item) => item.quantity > 0);
  const byKey = new Map(normalized.map((item) => [`${item.category}|${item.code}`, item]));
  const used = new Set();
  const lines = [];

  for (const item of normalized.sort((a, b) => a.code.localeCompare(b.code) || a.category.localeCompare(b.category))) {
    const key = `${item.category}|${item.code}`;
    if (used.has(key)) continue;
    if (item.category === "A") {
      const pair = byKey.get(`B|${item.code}`);
      if (pair && !used.has(`B|${item.code}`)) {
        lines.push(`AB ${item.code}=${item.quantity}*${pair.quantity}`);
        used.add(key); used.add(`B|${item.code}`);
        continue;
      }
    }
    lines.push(`${item.category} ${item.code}=${item.quantity}`);
    used.add(key);
  }
  return lines;
}

export function validateActualSpecialCodes(items = [], profiles = DEFAULT_POINT_PROFILES) {
  const counts = new Map();
  const seen = new Set();
  for (const item of items) {
    const category = String(item.category || "").toUpperCase();
    const code = String(item.code || "").trim();
    if (!profiles[category] || !code) throw new Error("INVALID_SPECIAL_POINT_CODE");
    const key = `${category}|${code}`;
    if (seen.has(key)) throw new Error("DUPLICATE_SPECIAL_POINT_CODE");
    seen.add(key);
    counts.set(category, (counts.get(category) || 0) + 1);
    if (counts.get(category) > Number(profiles[category].max_special_codes)) throw new Error(`SPECIAL_POINT_LIMIT_${category}`);
  }
  return Object.fromEntries([...counts.entries()]);
}
