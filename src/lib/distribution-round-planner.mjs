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


export function normalizeLineGroupApprovedTargets(rows = []) {
  if (!Array.isArray(rows)) {
    throw new Error('INVALID_DISTRIBUTION_TARGETS');
  }

  return rows.map((row) => {
    const lineGroupId = String(
      row.line_group_id || '',
    ).trim();

    const category = String(
      row.category || '',
    ).toUpperCase();

    const code = String(
      row.code || '',
    ).trim();

    const quantity = Number(
      row.quantity ?? row.recommended_cut ?? 0,
    );

    const expectedRetained = Number(
      row.expected_retained_quantity
        ?? row.order_total
        ?? 0,
    );

    const expectedMultiplier = Number(
      row.expected_effective_multiplier
        ?? row.effective_multiplier
        ?? 0,
    );

    const retentionLimit = Number(
      row.retention_limit,
    );

    if (!lineGroupId) {
      throw new Error('LINE_GROUP_ID_REQUIRED');
    }

    if (
      !['A','B','E','F','G','H','L'].includes(category)
      || !code
    ) {
      throw new Error('INVALID_TRANSFER_ITEM');
    }

    if (
      !Number.isSafeInteger(quantity)
      || quantity <= 0
      || !Number.isSafeInteger(expectedRetained)
      || expectedRetained < 0
      || !Number.isSafeInteger(retentionLimit)
      || retentionLimit < 0
      || !Number.isFinite(expectedMultiplier)
      || expectedMultiplier <= 0
    ) {
      throw new Error('INVALID_TRANSFER_ITEM');
    }

    const expectedCut = Math.max(
      0,
      expectedRetained - retentionLimit,
    );

    if (quantity !== expectedCut) {
      throw new Error(
        'RETENTION_RECOMMENDATION_MISMATCH',
      );
    }

    return {
      line_group_id: lineGroupId,
      category,
      code,
      quantity,
      expected_retained_quantity: expectedRetained,
      expected_effective_multiplier: expectedMultiplier,
      retention_limit: retentionLimit,
    };
  });
}


export function splitLineGroupDistributionRounds({
  targets = [],
  warehouses = [],
  maxRounds = 500,
} = {}) {
  const normalizedTargets =
    normalizeLineGroupApprovedTargets(targets)
      .map((row) => ({
        ...row,
        remaining: row.quantity,
      }));

  const normalizedWarehouses =
    normalizeWarehouseChoices(warehouses);

  if (!normalizedTargets.length) {
    throw new Error('DISTRIBUTION_TARGETS_REQUIRED');
  }

  if (!normalizedWarehouses.length) {
    throw new Error('WAREHOUSE_SELECTION_REQUIRED');
  }

  const lineGroupIds = new Set(
    normalizedTargets.map(
      (row) => row.line_group_id,
    ),
  );

  if (lineGroupIds.size !== 1) {
    throw new Error(
      'MIXED_LINE_GROUP_DISTRIBUTION_NOT_ALLOWED',
    );
  }

  const rounds = [];
  let warehouseIndex = 0;

  let totalRemaining = normalizedTargets.reduce(
    (sum, row) => sum + row.remaining,
    0,
  );

  while (totalRemaining > 0) {
    if (rounds.length >= maxRounds) {
      throw new Error(
        'DISTRIBUTION_ROUND_LIMIT',
      );
    }

    const warehouse =
      normalizedWarehouses[
        warehouseIndex
        % normalizedWarehouses.length
      ];

    warehouseIndex += 1;

    let capacity =
      warehouse.max_batch_quantity;

    const items = [];

    for (const target of normalizedTargets) {
      if (capacity <= 0) break;
      if (target.remaining <= 0) continue;

      const quantity = Math.min(
        target.remaining,
        capacity,
      );

      items.push({
        line_group_id:
          target.line_group_id,
        category:
          target.category,
        code:
          target.code,
        quantity,
        expected_retained_quantity:
          target.expected_retained_quantity,
        expected_effective_multiplier:
          target.expected_effective_multiplier,
        retention_limit:
          target.retention_limit,
      });

      target.remaining -= quantity;
      capacity -= quantity;
      totalRemaining -= quantity;
    }

    if (!items.length) {
      throw new Error(
        'DISTRIBUTION_ROUND_EMPTY',
      );
    }

    rounds.push({
      round_index: rounds.length + 1,
      destination:
        warehouse.destination,
      destination_limit:
        warehouse.max_batch_quantity,
      quantity: items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
      items,
    });
  }

  return {
    line_group_id:
      normalizedTargets[0].line_group_id,
    rounds,
    total_quantity: rounds.reduce(
      (sum, round) =>
        sum + round.quantity,
      0,
    ),
    round_count: rounds.length,
    warehouse_count:
      normalizedWarehouses.length,
  };
}
