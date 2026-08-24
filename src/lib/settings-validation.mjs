const CATEGORIES = new Set(["A", "B", "E", "F", "G"]);

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
  return { line_group_id, line_group_name, summary_group_id, enabled: normalizeBoolean(input.enabled, true) };
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
  const canonical_category = normalizeCategory(input.canonical_category);
  if (!alias || alias.length > 32) throw new Error("INVALID_ALIAS");
  return { alias, canonical_category, enabled: normalizeBoolean(input.enabled, true) };
}
