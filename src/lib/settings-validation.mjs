const CATEGORIES = new Set(["A", "B", "E", "F", "G", "H", "L"]);
const ALIAS_TARGETS = new Set(["A", "B", "AB", "C", "ABC", "D", "E", "F", "G", "H", "L", "DOUBLE", "PERMUTE_ALL"]);

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

export function validateMirrorRoute(input = {}) {
  const id = String(input.id ?? "").trim();

  const source_line_group_id =
    String(
      input.source_line_group_id
      ?? "",
    ).trim();

  const destination_line_group_id =
    String(
      input.destination_line_group_id
      ?? "",
    ).trim();

  if (
    id
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new Error(
      "INVALID_MIRROR_ROUTE_ID",
    );
  }

  if (
    !/^C[A-Za-z0-9_-]{8,}$/.test(
      source_line_group_id,
    )
  ) {
    throw new Error(
      "INVALID_MIRROR_SOURCE_LINE_GROUP_ID",
    );
  }

  if (
    !/^C[A-Za-z0-9_-]{8,}$/.test(
      destination_line_group_id,
    )
  ) {
    throw new Error(
      "INVALID_MIRROR_DESTINATION_LINE_GROUP_ID",
    );
  }

  if (
    source_line_group_id
    === destination_line_group_id
  ) {
    throw new Error(
      "INVALID_MIRROR_ROUTE_SELF",
    );
  }

  const max_batch_size =
    Number(
      input.max_batch_size
      ?? 5,
    );

  if (
    !Number.isInteger(
      max_batch_size,
    )
    || max_batch_size < 1
    || max_batch_size > 5
  ) {
    throw new Error(
      "INVALID_MIRROR_MAX_BATCH_SIZE",
    );
  }

  const flush_after_seconds =
    Number(
      input.flush_after_seconds
      ?? 30,
    );

  if (
    !Number.isInteger(
      flush_after_seconds,
    )
    || flush_after_seconds < 5
    || flush_after_seconds > 300
  ) {
    throw new Error(
      "INVALID_MIRROR_FLUSH_SECONDS",
    );
  }

  return {
    id:
      id || null,

    source_line_group_id,
    destination_line_group_id,

    enabled:
      normalizeBoolean(
        input.enabled,
        false,
      ),

    max_batch_size,
    flush_after_seconds,
  };
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
  const minMultiplier = ["H", "L"].includes(category) ? 0 : Number.EPSILON;
  if (!Number.isFinite(special_multiplier) || special_multiplier < minMultiplier || special_multiplier > 1000000) throw new Error("INVALID_POINT_MULTIPLIER");
  if (!Number.isInteger(max_special_codes) || max_special_codes <= 0 || max_special_codes > 100) throw new Error("INVALID_POINT_CODE_LIMIT");
  if (category === "H" && max_special_codes !== 3) throw new Error("INVALID_POINT_CODE_LIMIT_H");
  if (category === "L" && max_special_codes !== 2) throw new Error("INVALID_POINT_CODE_LIMIT_L");
  return { category, special_multiplier, max_special_codes, updated_at: new Date().toISOString() };
}


export function validateRiskBudget(input = {}) {
  const summary_group_id = String(input.summary_group_id ?? "").trim().toUpperCase();
  const risk_pool = String(input.risk_pool ?? "MAIN").trim().toUpperCase();
  const point_loss_tolerance = Number(input.point_loss_tolerance);
  if (!/^[A-Z0-9_-]{1,32}$/.test(summary_group_id)) throw new Error("INVALID_SUMMARY_GROUP_ID");
  if (!["MAIN", "H", "L"].includes(risk_pool)) throw new Error("INVALID_RISK_POOL");
  if (!Number.isFinite(point_loss_tolerance) || point_loss_tolerance < 0 || point_loss_tolerance > 100000000) throw new Error("INVALID_POINT_LOSS_TOLERANCE");
  return { summary_group_id, risk_pool, point_loss_tolerance, updated_at: new Date().toISOString() };
}

export function validateWarehouseLimit(input = {}) {
  const destination = String(input.destination ?? "").trim();
  const max_batch_quantity = Number(input.max_batch_quantity);
  if (!destination || destination.length > 150) throw new Error("INVALID_DESTINATION");
  if (!Number.isInteger(max_batch_quantity) || max_batch_quantity <= 0 || max_batch_quantity > 100000000) throw new Error("INVALID_WAREHOUSE_BATCH_LIMIT");
  return { destination, max_batch_quantity, enabled: normalizeBoolean(input.enabled, true), updated_at: new Date().toISOString() };
}
