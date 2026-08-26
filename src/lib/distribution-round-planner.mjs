export function normalizeWarehouseChoices(rows = []) {
  return (rows || [])
    .map((row) => ({
      destination: String(row.destination || '').trim(),
      max_batch_quantity: Math.max(0, Math.floor(Number(row.max_batch_quantity || 0))),
    }))
    .filter((row) => row.destination && row.max_batch_quantity > 0);
}

export function normalizeApprovedTargets(rows = []) {
  return (rows || [])
    .map((row) => ({
      category: String(row.category || '').toUpperCase(),
      code: String(row.code || '').trim(),
      quantity: Math.max(0, Math.floor(Number(row.quantity ?? row.recommended_transfer ?? 0))),
      expected_retained_quantity: Math.max(0, Math.floor(Number(row.expected_retained_quantity ?? row.retained_quantity ?? 0))),
      expected_effective_multiplier: Number(row.expected_effective_multiplier ?? row.effective_multiplier ?? 0),
    }))
    .filter((row) => ['A','B','E','F','G','H','L'].includes(row.category) && row.code && row.quantity > 0 && Number.isFinite(row.expected_effective_multiplier) && row.expected_effective_multiplier >= 0);
}

/**
 * Split one already-approved dynamic distribution plan into warehouse rounds.
 * Each round belongs to one destination and never exceeds that destination's
 * per-round limit. Warehouses rotate round-robin so several destinations can
 * share the work without extra user clicks.
 */
export function splitDistributionRounds({ targets = [], warehouses = [], maxRounds = 500 } = {}) {
  const normalizedTargets = normalizeApprovedTargets(targets).map((row) => ({ ...row, remaining: row.quantity }));
  const normalizedWarehouses = normalizeWarehouseChoices(warehouses);
  if (!normalizedTargets.length) throw new Error('DISTRIBUTION_TARGETS_REQUIRED');
  if (!normalizedWarehouses.length) throw new Error('WAREHOUSE_SELECTION_REQUIRED');

  const rounds = [];
  let warehouseIndex = 0;
  let totalRemaining = normalizedTargets.reduce((sum, row) => sum + row.remaining, 0);

  while (totalRemaining > 0) {
    if (rounds.length >= maxRounds) throw new Error('DISTRIBUTION_ROUND_LIMIT');
    const warehouse = normalizedWarehouses[warehouseIndex % normalizedWarehouses.length];
    warehouseIndex += 1;
    let capacity = warehouse.max_batch_quantity;
    const items = [];

    for (const target of normalizedTargets) {
      if (capacity <= 0) break;
      if (target.remaining <= 0) continue;
      const quantity = Math.min(target.remaining, capacity);
      items.push({
        category: target.category,
        code: target.code,
        quantity,
        expected_retained_quantity: target.expected_retained_quantity,
        expected_effective_multiplier: target.expected_effective_multiplier,
      });
      target.remaining -= quantity;
      capacity -= quantity;
      totalRemaining -= quantity;
    }

    if (!items.length) throw new Error('DISTRIBUTION_ROUND_EMPTY');
    rounds.push({
      round_index: rounds.length + 1,
      destination: warehouse.destination,
      destination_limit: warehouse.max_batch_quantity,
      quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      items,
    });
  }

  return {
    rounds,
    total_quantity: rounds.reduce((sum, round) => sum + round.quantity, 0),
    round_count: rounds.length,
    warehouse_count: normalizedWarehouses.length,
  };
}
