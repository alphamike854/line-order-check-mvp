import {
  fetchSettings,
  json,
  requireDashboardAccess,
  supabase,
  writeSettingsAudit,
} from "../../src/lib/dashboard-api.mjs";
import {
  validateAllocationRule,
  validateCategoryAlias,
  validateLineGroup,
  validatePointProfile,
  validateRiskBudget,
  validateSummaryGroup,
  validateWarehouseLimit,
} from "../../src/lib/settings-validation.mjs";

const OPERATOR = process.env.DASHBOARD_OPERATOR_NAME || "DASHBOARD";

async function maybeSingle(table, filters) {
  let query = supabase.from(table).select("*");
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function assertSummaryGroupExists(id) {
  const row = await maybeSingle("summary_groups", { id });
  if (!row) throw new Error("SUMMARY_GROUP_NOT_FOUND");
}

async function saveSummaryGroup(values) {
  const row = validateSummaryGroup(values);
  const before = await maybeSingle("summary_groups", { id: row.id });
  const { data, error } = await supabase.from("summary_groups").upsert(row, { onConflict: "id" }).select("*").single();
  if (error) throw error;
  await writeSettingsAudit({ entityType: "SUMMARY_GROUP", entityKey: row.id, beforeData: before, afterData: data, changedBy: OPERATOR });
  return data;
}

async function saveLineGroup(values) {
  const row = validateLineGroup(values);
  await assertSummaryGroupExists(row.summary_group_id);
  const before = await maybeSingle("line_groups", { line_group_id: row.line_group_id });
  const payload = { ...row, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("line_groups").upsert(payload, { onConflict: "line_group_id" }).select("*").single();
  if (error) throw error;

  // A LINE group registered while a settlement is OPEN must become usable
  // immediately. Insert a snapshot only when it does not already exist.
  // Existing snapshot name/mapping stay frozen; reduction % remains live.
  const { data: openSession, error: openError } = await supabase
    .from("settlement_sessions").select("id").eq("status", "OPEN").maybeSingle();
  if (openError) throw openError;

  if (openSession?.id) {
    if (row.enabled) {
      const snapshotPayload = {
        settlement_session_id: openSession.id,
        line_group_id: row.line_group_id,
        line_group_name: row.line_group_name,
        summary_group_id: row.summary_group_id,
        reduction_pct: row.reduction_pct,
        enabled: true,
      };

      const { error: snapshotError } = await supabase
        .from("settlement_line_group_config")
        .upsert(snapshotPayload, {
          onConflict: "settlement_session_id,line_group_id",
          ignoreDuplicates: true,
        });
      if (snapshotError) throw snapshotError;
    }

    const { error: operationalError } = await supabase
      .from("settlement_line_group_config")
      .update({
        reduction_pct: row.reduction_pct,
        enabled: row.enabled,
      })
      .eq("settlement_session_id", openSession.id)
      .eq("line_group_id", row.line_group_id);
    if (operationalError) throw operationalError;
  }

  // Keep the existing LINE-group audit for mapping/name changes; no reason field is required.
  await writeSettingsAudit({ entityType: "LINE_GROUP", entityKey: row.line_group_id, beforeData: before, afterData: data, changedBy: OPERATOR });
  return data;
}

async function saveAllocationRule(values) {
  const row = validateAllocationRule(values);
  await assertSummaryGroupExists(row.summary_group_id);
  const before = await maybeSingle("allocation_rules", { summary_group_id: row.summary_group_id, category: row.category });
  const payload = { ...row, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("allocation_rules").upsert(payload, { onConflict: "summary_group_id,category" }).select("*").single();
  if (error) throw error;
  await writeSettingsAudit({ entityType: "ALLOCATION_RULE", entityKey: `${row.summary_group_id}|${row.category}`, beforeData: before, afterData: data, changedBy: OPERATOR });
  return data;
}


async function savePointProfile(values) {
  const row = validatePointProfile(values);
  const before = await maybeSingle("point_category_profiles", { category: row.category });
  const { data, error } = await supabase.from("point_category_profiles").upsert(row, { onConflict: "category" }).select("*").single();
  if (error) throw error;
  await writeSettingsAudit({ entityType: "POINT_PROFILE", entityKey: row.category, beforeData: before, afterData: data, changedBy: OPERATOR });
  return data;
}

async function saveRiskBudget(values) {
  const row = validateRiskBudget(values);
  await assertSummaryGroupExists(row.summary_group_id);
  const before = await maybeSingle("summary_group_risk_pool_settings", { summary_group_id: row.summary_group_id, risk_pool: row.risk_pool });
  const { data, error } = await supabase.from("summary_group_risk_pool_settings").upsert(row, { onConflict: "summary_group_id,risk_pool" }).select("*").single();
  if (error) throw error;
  // Keep the legacy MAIN table synchronized for older utilities/RPC diagnostics.
  if (row.risk_pool === "MAIN") {
    const { error: legacyError } = await supabase.from("summary_group_risk_settings")
      .upsert({ summary_group_id: row.summary_group_id, point_loss_tolerance: row.point_loss_tolerance, updated_at: row.updated_at }, { onConflict: "summary_group_id" });
    if (legacyError) throw legacyError;
  }
  await writeSettingsAudit({ entityType: "RISK_BUDGET", entityKey: `${row.summary_group_id}|${row.risk_pool}`, beforeData: before, afterData: data, changedBy: OPERATOR });
  return data;
}

async function saveWarehouseLimit(values) {
  const row = validateWarehouseLimit(values);
  const before = await maybeSingle("warehouse_transfer_limits", { destination: row.destination });
  const { data, error } = await supabase.from("warehouse_transfer_limits").upsert(row, { onConflict: "destination" }).select("*").single();
  if (error) throw error;
  await writeSettingsAudit({ entityType: "WAREHOUSE_LIMIT", entityKey: row.destination, beforeData: before, afterData: data, changedBy: OPERATOR });
  return data;
}

async function saveAlias(values) {
  const row = validateCategoryAlias(values);
  const before = await maybeSingle("category_aliases", { alias: row.alias });
  const { data, error } = await supabase.from("category_aliases").upsert(row, { onConflict: "alias" }).select("*").single();
  if (error) throw error;
  await writeSettingsAudit({ entityType: "CATEGORY_ALIAS", entityKey: row.alias, beforeData: before, afterData: data, changedBy: OPERATOR });
  return data;
}

export default async (req) => {
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    if (req.method === "GET") {
      const settings = await fetchSettings();
      return json({ ok: true, settings });
    }

    if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    const body = await req.json();
    const entity = String(body.entity ?? "").trim().toUpperCase();
    let saved;

    if (entity === "SUMMARY_GROUP") saved = await saveSummaryGroup(body.values);
    else if (entity === "LINE_GROUP") saved = await saveLineGroup(body.values);
    else if (entity === "ALLOCATION_RULE") saved = await saveAllocationRule(body.values);
    else if (entity === "CATEGORY_ALIAS") saved = await saveAlias(body.values);
    else if (entity === "POINT_PROFILE") saved = await savePointProfile(body.values);
    else if (entity === "RISK_BUDGET") saved = await saveRiskBudget(body.values);
    else if (entity === "WAREHOUSE_LIMIT") saved = await saveWarehouseLimit(body.values);
    else return json({ ok: false, error: "INVALID_SETTINGS_ENTITY" }, 400);

    return json({ ok: true, entity, saved });
  } catch (error) {
    const message = error?.message ?? String(error);
    const status = message.endsWith("_NOT_FOUND") ? 404 : message.startsWith("INVALID_") ? 400 : 500;
    console.error("settings failed", error);
    return json({ ok: false, error: message }, status);
  }
};

export const config = { path: "/api/settings" };
