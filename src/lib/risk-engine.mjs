export const DEFAULT_POINT_PROFILES = Object.freeze({
  A: { multiplier: 14, max_special_codes: 1 },
  B: { multiplier: 14, max_special_codes: 1 },
  E: { multiplier: 100, max_special_codes: 1 },
  F: { multiplier: 20, max_special_codes: 6 },
  G: { multiplier: 20, max_special_codes: 4 },
});

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function effectiveMultiplier(multiplier, promotionFactorPct = 100) {
  const base = Number(multiplier || 0);
  const factor = Number(promotionFactorPct ?? 100);
  if (!Number.isFinite(base) || base < 0) throw new Error("INVALID_POINT_MULTIPLIER");
  if (!Number.isFinite(factor) || factor < 0 || factor > 100) throw new Error("INVALID_PROMOTION_FACTOR");
  return round2(base * factor / 100);
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

export function overallRiskMetrics({ adjustedTotal = 0, pointReserve = 0, actualPoint = null, confirmedCut = 0 } = {}) {
  const adjusted = round2(adjustedTotal);
  const reserve = round2(pointReserve);
  const actual = actualPoint == null ? null : round2(actualPoint);
  // Warehouse safety remains conservative throughout an OPEN settlement.
  // Actual Point codes are used for final reconciliation/reporting only.
  const riskPoint = reserve;
  const mode = "RESERVE";
  const net = round2(adjusted - riskPoint);
  const confirmed = round2(confirmedCut);
  const remaining = round2(Math.max(0, net - confirmed));
  const over = round2(Math.max(0, confirmed - net));
  const riskPct = adjusted > 0 ? round2(riskPoint / adjusted * 100) : (riskPoint > 0 ? 100 : 0);
  return {
    adjusted_total: adjusted,
    point_reserve: reserve,
    actual_point: actual,
    risk_point_total: riskPoint,
    risk_mode: mode,
    net_safe_capacity: net,
    confirmed_cut_total: confirmed,
    remaining_safe_capacity: remaining,
    over_safe_amount: over,
    risk_pct: riskPct,
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
