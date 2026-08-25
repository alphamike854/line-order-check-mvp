export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function reducedQuantity(receivedTotal, reductionPct) {
  const received = Number(receivedTotal || 0);
  const pct = Number(reductionPct || 0);
  return round2(received * (1 - pct / 100));
}

export function specialPointForQuantity(quantity, multiplier) {
  return Number(quantity || 0) * Number(multiplier || 0);
}

export function reconciliationTotal(receivedTotal, reductionPct, specialPointTotal) {
  return round2(reducedQuantity(receivedTotal, reductionPct) - Number(specialPointTotal || 0));
}

export function compactSpecialPointDetails(items = []) {
  return items
    .filter((item) => Number(item.quantity) > 0 && Number(item.multiplier) > 1)
    .map((item) => ({
      category: String(item.category || ""),
      code: String(item.code || ""),
      quantity: Number(item.quantity),
      multiplier: Number(item.multiplier),
      points: specialPointForQuantity(item.quantity, item.multiplier),
    }));
}

export function thresholdProgress(orderTotal, threshold) {
  const total = Math.max(0, Number(orderTotal || 0));
  const t = Math.max(1, Number(threshold || 1));
  return {
    full_segments: Math.floor(total / t),
    remainder: total % t,
    remainder_pct: Math.min(100, ((total % t) / t) * 100),
  };
}
