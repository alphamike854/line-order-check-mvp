"use strict";

/**
 * Allocation Engine v1.0.0
 * Threshold is applied PER CODE within a Summary Group + Category.
 *
 * Example threshold 100:
 *  99 => 0
 * 100 => 0
 * 199 => 0
 * 200 => 100
 * 210 => 100
 * 300 => 200
 */
function calculateAllocation(orderTotal, threshold, confirmedTransfer = 0) {
  const q = Number(orderTotal);
  const t = Number(threshold);
  const confirmed = Number(confirmedTransfer || 0);

  if (!Number.isFinite(q) || q < 0) throw new Error("orderTotal must be >= 0");
  if (!Number.isFinite(t) || t <= 0) throw new Error("threshold must be > 0");
  if (!Number.isFinite(confirmed) || confirmed < 0) throw new Error("confirmedTransfer must be >= 0");

  const fullBlocks = Math.floor(q / t);
  const shouldTransfer = Math.max(0, (fullBlocks - 1) * t);
  const transferNow = Math.max(0, shouldTransfer - confirmed);

  return {
    orderTotal: q,
    threshold: t,
    shouldTransfer,
    confirmedTransfer: confirmed,
    transferNow,
    review: confirmed > shouldTransfer,
    reviewReason: confirmed > shouldTransfer
      ? "CONFIRMED_TRANSFER_EXCEEDS_CURRENT_REQUIREMENT"
      : null
  };
}

export { calculateAllocation };
