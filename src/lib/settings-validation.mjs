const CATEGORIES = new Set(["A", "B", "E", "F", "G"]);
const ALIAS_TARGETS = new Set(["A", "B", "C", "D", "E", "F", "G", "DOUBLE"]);

export function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  throw new Error("INVALID_BOOLEAN");
}

export function normalizeCategory(value) {
  const category = String(value ?? "").trim().toUpperCase();
  if (!CATEGORIES.has(category)) throw new Error("INVALID_CATEGORY");
  return category;
}

export function validateSummaryGroup(input = {}) {
  const id = String(input.id ?? "").trim().toUpperCase();
  const name = String(input.name ?? "").trim();
  if (!/^[A-Z0-9_-]{1,32}$/.test(id)) throw new Error("INVALID_SUMMARY_GROUP_ID");
  if (!name || name.length > 100) throw new Error("INVALID_SUMMARY_GROUP_NAME");
  return { id, name, enabled: normalizeBoolean(input.enabled, true) };
}

export function validateLineGroup(input = {}) {
  const line_group_id = String(input.line_group_id ?? "").trim();
  const line_group_name = String(input.line_group_name ?? "").trim();
  const summary_group_id = String(input.summary_group_id ?? "").trim().toUpperCase();
  if (!/^C[A-Za-z0-9_-]{8,}$/.test(line_group_id)) throw new Error("INVALID_LINE_GROUP_ID");
  if (!line_group_name || line_group_name.length > 120) throw new Error("INVALID_LINE_GROUP_NAME");
  if (!/^[A-Z0-9_-]{1,32}$/.test(summary_group_id)) throw new Error("INVALID_SUMMARY_GROUP_ID");
  const reduction_pct = Number(input.reduction_pct ?? 0);
  if (!Number.isFinite(reduction_pct) || reduction_pct < 0 || reduction_pct > 100) throw new Error("INVALID_REDUCTION_PCT");
  return { line_group_id, line_group_name, summary_group_id, reduction_pct, enabled: normalizeBoolean(input.enabled, true) };
}

export function validateAllocationRule(input = {}) {
  const summary_group_id = String(input.summary_group_id ?? "").trim().toUpperCase();
  const category = normalizeCategory(input.category);
  const threshold = Number(input.threshold);
  const destination = String(input.destination ?? "").trim() || null;
  if (!/^[A-Z0-9_-]{1,32}$/.test(summary_group_id)) throw new Error("INVALID_SUMMARY_GROUP_ID");
  if (!Number.isInteger(threshold) || threshold <= 0 || threshold > 100000000) throw new Error("INVALID_THRESHOLD");
  if (destination && destination.length > 150) throw new Error("INVALID_DESTINATION");
  return { summary_group_id, category, threshold, destination, enabled: normalizeBoolean(input.enabled, true) };
}

export function validateCategoryAlias(input = {}) {
  const alias = String(input.alias ?? "").trim();
  const canonical_category = String(input.canonical_category ?? "").trim().toUpperCase();
  if (!alias || alias.length > 32 || /^\d+$/.test(alias)) throw new Error("INVALID_ALIAS");
  if (!ALIAS_TARGETS.has(canonical_category)) throw new Error("INVALID_ALIAS_TARGET");
  return { alias, canonical_category, enabled: normalizeBoolean(input.enabled, true) };
}

export function validatePointProfile(input = {}) {
  const category = normalizeCategory(input.category);
  const special_multiplier = Number(input.special_multiplier);
  const max_special_codes = Number(input.max_special_codes);
  if (!Number.isFinite(special_multiplier) || special_multiplier <= 0 || special_multiplier > 1000000) throw new Error("INVALID_POINT_MULTIPLIER");
  if (!Number.isInteger(max_special_codes) || max_special_codes <= 0 || max_special_codes > 100) throw new Error("INVALID_POINT_CODE_LIMIT");
  return { category, special_multiplier, max_special_codes, updated_at: new Date().toISOString() };
}


export function validateRiskBudget(input = {}) {
  const summary_group_id = String(input.summary_group_id ?? "").trim().toUpperCase();
  const point_loss_tolerance = Number(input.point_loss_tolerance);
  if (!/^[A-Z0-9_-]{1,32}$/.test(summary_group_id)) throw new Error("INVALID_SUMMARY_GROUP_ID");
  if (!Number.isFinite(point_loss_tolerance) || point_loss_tolerance < 0 || point_loss_tolerance > 100000000) throw new Error("INVALID_POINT_LOSS_TOLERANCE");
  return { summary_group_id, point_loss_tolerance, updated_at: new Date().toISOString() };
}

export function validateWarehouseLimit(input = {}) {
  const destination = String(input.destination ?? "").trim();
  const max_batch_quantity = Number(input.max_batch_quantity);
  if (!destination || destination.length > 150) throw new Error("INVALID_DESTINATION");
  if (!Number.isInteger(max_batch_quantity) || max_batch_quantity <= 0 || max_batch_quantity > 100000000) throw new Error("INVALID_WAREHOUSE_BATCH_LIMIT");
  return { destination, max_batch_quantity, enabled: normalizeBoolean(input.enabled, true), updated_at: new Date().toISOString() };
}
