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
  validateMirrorRoute,
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

async function fetchLineGroup(id) {
  return maybeSingle(
    "line_groups",
    {
      line_group_id: id,
    },
  );
}

async function assertMirrorSourceExists(id) {
  const row =
    await fetchLineGroup(id);

  if (!row) {
    throw new Error(
      "MIRROR_SOURCE_LINE_GROUP_NOT_FOUND",
    );
  }

  return row;
}

async function resolveMirrorDestination(
  id,
  existingRoute = null,
) {
  const configured =
    await fetchLineGroup(id);

  if (configured) {
    return {
      kind: "CONFIGURED_ORDER_GROUP",
      configured,
    };
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("webhook_events")
      .select("line_group_id")
      .eq(
        "line_group_id",
        id,
      )
      .limit(1)
      .maybeSingle();

  if (error) throw error;

  if (data) {
    return {
      kind: "OBSERVED_LINE_ROOM",
      configured: null,
    };
  }

  if (
    existingRoute
    && existingRoute.destination_line_group_id
      === id
  ) {
    return {
      kind: "EXISTING_ROUTE_DESTINATION",
      configured: null,
    };
  }

  throw new Error(
    "MIRROR_DESTINATION_NOT_FOUND",
  );
}

function mirrorTransportEnabled() {
  return (
    String(
      process.env.LINE_MESSAGE_MIRROR_ENABLED
        ?? "",
    )
      .trim()
      .toLowerCase()
    === "true"
  );
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

  const before = await maybeSingle("line_groups", {
    line_group_id: row.line_group_id,
  });

  let result = null;
  let saveError = null;

  // A live remap can briefly race with atomic webhook persistence.
  // Both database paths are transactional, so retry only PostgreSQL
  // deadlock / serialization failures once. Never retry business-rule
  // conflicts such as confirmed allocation/transfer/distribution.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await supabase.rpc(
      "save_line_group_live",
      {
        p_line_group_id: row.line_group_id,
        p_line_group_name: row.line_group_name,
        p_summary_group_id: row.summary_group_id,
        p_reduction_pct: row.reduction_pct,
        p_enabled: row.enabled,
      },
    );

    result = response.data;
    saveError = response.error;

    if (!saveError) break;

    const retryable =
      saveError.code === "40P01" ||
      saveError.code === "40001";

    if (!retryable || attempt === 1) {
      break;
    }
  }

  if (saveError) throw saveError;

  const saved = result?.line_group ?? row;

  await writeSettingsAudit({
    entityType: "LINE_GROUP",
    entityKey: row.line_group_id,
    beforeData: before,
    afterData: saved,
    changedBy: OPERATOR,
  });

  return saved;
}

async function saveMirrorRoute(values) {
  const row =
    validateMirrorRoute(values);

  let before = null;

  if (row.id) {
    before =
      await maybeSingle(
        "line_message_mirror_routes",
        {
          id: row.id,
        },
      );

    if (!before) {
      throw new Error(
        "MIRROR_ROUTE_NOT_FOUND",
      );
    }

    const identityChanged =
      before.source_line_group_id
        !== row.source_line_group_id
      || before.destination_line_group_id
        !== row.destination_line_group_id;

    if (identityChanged) {
      throw new Error(
        "MIRROR_ROUTE_IDENTITY_IMMUTABLE",
      );
    }
  }

  const [
    source,
    destination,
  ] =
    await Promise.all([
      assertMirrorSourceExists(
        row.source_line_group_id,
      ),
      resolveMirrorDestination(
        row.destination_line_group_id,
        before,
      ),
    ]);

  if (row.enabled) {
    if (!source.enabled) {
      throw new Error(
        "MIRROR_SOURCE_DISABLED",
      );
    }

    if (
      destination.configured?.enabled
      === true
    ) {
      throw new Error(
        "MIRROR_DESTINATION_ACTIVE_ORDER_GROUP",
      );
    }

    if (!mirrorTransportEnabled()) {
      throw new Error(
        "MIRROR_GLOBAL_DISABLED",
      );
    }
  }

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "save_mirror_route_settings",
      {
        p_route_id:
          row.id ?? null,

        p_source_line_group_id:
          row.source_line_group_id,

        p_destination_line_group_id:
          row.destination_line_group_id,

        p_enabled:
          row.enabled,

        p_max_batch_size:
          row.max_batch_size,

        p_flush_after_seconds:
          row.flush_after_seconds,

        p_changed_by:
          OPERATOR,
      },
    );

  if (error) {
    const message =
      String(
        error.message
        ?? "",
      );

    const knownErrors = [
      "MIRROR_ROUTE_NOT_FOUND",
      "MIRROR_ROUTE_IDENTITY_IMMUTABLE",
      "MIRROR_ROUTE_DUPLICATE",
      "MIRROR_ROUTE_SELF",
      "MIRROR_ROUTE_INVALID_BATCH_SIZE",
      "MIRROR_ROUTE_INVALID_FLUSH_SECONDS",
      "MIRROR_SOURCE_NOT_FOUND",
      "MIRROR_SOURCE_DISABLED",
      "MIRROR_DESTINATION_NOT_FOUND",
      "MIRROR_DESTINATION_ACTIVE_ORDER_GROUP",
    ];

    const known =
      knownErrors.find(
        (code) =>
          message.includes(code),
      );

    if (known) {
      throw new Error(known);
    }

    throw error;
  }

  const saved =
    data?.route;

  if (!saved?.id) {
    throw new Error(
      "MIRROR_ROUTE_SAVE_INVALID",
    );
  }

  return saved;
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
      const {
        data: exportDestinations,
        error: exportDestinationsError,
      } = await supabase
        .from("export_destination_line_groups")
        .select(
          "line_group_id,label,enabled,verification_source,created_at,updated_at"
        )
        .order("label", { ascending: true });

      if (exportDestinationsError) {
        throw exportDestinationsError;
      }

      const {
        data: openRoundInputs,
        error: openRoundInputsError,
      } = await supabase
        .from(
          "settlement_line_group_round_config_working_context"
        )
        .select("line_group_id")
        .eq("round_status", "OPEN");

      if (openRoundInputsError) {
        throw openRoundInputsError;
      }

      const openRoundInputIds = new Set(
        (openRoundInputs || [])
          .map((row) =>
            String(row?.line_group_id ?? "").trim()
          )
          .filter(Boolean),
      );

      const exportCandidateMap = new Map();

      const addExportCandidate = (
        lineGroupId,
        label,
        source,
        activeOrderGroup = false,
      ) => {
        const id =
          String(lineGroupId ?? "").trim();

        if (!id) return;

        const current =
          exportCandidateMap.get(id) || {};

        exportCandidateMap.set(
          id,
          {
            line_group_id: id,
            label:
              String(
                label
                ?? current.label
                ?? id
              ).trim()
              || id,
            source:
              source
              ?? current.source
              ?? "OBSERVED",
            active_order_group:
              Boolean(
                activeOrderGroup
                || current.active_order_group
              ),
            active_open_round_input:
              openRoundInputIds.has(id),
          },
        );
      };

      for (const row of settings.line_groups || []) {
        addExportCandidate(
          row?.line_group_id,
          row?.line_group_name
            ?? row?.name,
          "CONFIGURED",
          row?.enabled === true,
        );
      }

      for (
        const row
        of settings.unconfigured_line_groups || []
      ) {
        addExportCandidate(
          row?.line_group_id
            ?? row?.id,
          row?.line_group_name
            ?? row?.name,
          "OBSERVED",
          false,
        );
      }

      for (const row of settings.mirror_routes || []) {
        addExportCandidate(
          row?.destination_line_group_id,
          row?.destination_line_group_name
            ?? row?.destination_name,
          "MIRROR_DESTINATION",
          false,
        );
      }

      for (const row of exportDestinations || []) {
        addExportCandidate(
          row?.line_group_id,
          row?.label,
          "EXPORT_DESTINATION",
          false,
        );
      }

      settings.export_destinations =
        exportDestinations || [];

      settings.export_destination_candidates =
        [...exportCandidateMap.values()]
          .sort((a, b) =>
            String(a.label).localeCompare(
              String(b.label),
              "th",
            )
          );

      return json({ ok: true, settings });
    }

    if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    const body = await req.json();
    const entity = String(body.entity ?? "").trim().toUpperCase();
    let saved;

    if (entity === "SUMMARY_GROUP") saved = await saveSummaryGroup(body.values);
    else if (entity === "LINE_GROUP") saved = await saveLineGroup(body.values);
    else if (entity === "MIRROR_ROUTE") saved = await saveMirrorRoute(body.values);
    else if (entity === "EXPORT_DESTINATION") {
      const values = body.values ?? {};

      const lineGroupId =
        String(
          values.line_group_id
          ?? ""
        ).trim();

      const label =
        String(
          values.label
          ?? ""
        ).trim();

      if (!lineGroupId) {
        throw new Error(
          "EXPORT_DESTINATION_REQUIRED"
        );
      }

      if (!label || label.length > 150) {
        throw new Error(
          "EXPORT_DESTINATION_LABEL_INVALID"
        );
      }

      const {
        data,
        error,
      } = await supabase.rpc(
        "save_export_destination_settings",
        {
          p_line_group_id:
            lineGroupId,
          p_label:
            label,
          p_enabled:
            values.enabled === true,
          p_changed_by:
            "DASHBOARD",
        },
      );

      if (error) throw error;
      saved = data;
    }
    else if (entity === "ALLOCATION_RULE") saved = await saveAllocationRule(body.values);
    else if (entity === "CATEGORY_ALIAS") saved = await saveAlias(body.values);
    else if (entity === "POINT_PROFILE") saved = await savePointProfile(body.values);
    else if (entity === "RISK_BUDGET") saved = await saveRiskBudget(body.values);
    else if (entity === "WAREHOUSE_LIMIT") saved = await saveWarehouseLimit(body.values);
    else return json({ ok: false, error: "INVALID_SETTINGS_ENTITY" }, 400);

    return json({ ok: true, entity, saved });
  } catch (error) {
    const message = error?.message ?? String(error);

    const exportDestinationMatch =
      message.match(
        /\b(EXPORT_DESTINATION_[A-Z0-9_]+)\b/,
      );

    if (exportDestinationMatch) {
      const code =
        exportDestinationMatch[1];

      const conflict =
        code.includes("ACTIVE")
        || code.includes("OPEN_ROUND")
        || code.includes("UNRESOLVED")
        || code.includes("NOT_ALLOWED")
        || code.includes("IN_USE");

      return json(
        {
          ok: false,
          error: code,
        },
        conflict ? 409 : 400,
      );
    }
    const status =
      message.endsWith("_NOT_FOUND")
        ? 404
        : message.startsWith("INVALID_")
          ? 400
          : (
              message.startsWith(
                "SUMMARY_GROUP_REMAP_BLOCKED_",
              )
              || message === "MIRROR_ROUTE_DUPLICATE"
              || message === "MIRROR_GLOBAL_DISABLED"
              || message === "MIRROR_SOURCE_DISABLED"
              || message === "MIRROR_ROUTE_IDENTITY_IMMUTABLE"
              || message === "MIRROR_DESTINATION_ACTIVE_ORDER_GROUP"
              || message === "MIRROR_ROUTE_DISABLE_BEFORE_REMAP"
            )
            ? 409
            : 500;
    console.error("settings failed", error);
    return json({ ok: false, error: message }, status);
  }
};

export const config = { path: "/api/settings" };
