import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  bangkokDayRange,
  bangkokToday,
  normalizeBusinessDate,
  normalizeSummaryGroup,
} from "./dashboard-utils.mjs";


const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const DASHBOARD_ACCESS_KEY = process.env.DASHBOARD_ACCESS_KEY;

export const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_SECRET_KEY ?? "", {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function safeEqualString(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function requireDashboardAccess(req) {
  if (!DASHBOARD_ACCESS_KEY) {
    return json({ ok: false, error: "DASHBOARD_ACCESS_KEY_NOT_CONFIGURED" }, 503);
  }

  const supplied = req.headers.get("x-dashboard-key") ?? "";
  if (!safeEqualString(DASHBOARD_ACCESS_KEY, supplied)) {
    return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  return null;
}

export { bangkokDayRange, bangkokToday, normalizeBusinessDate, normalizeSummaryGroup };

export async function loadGroupConfig() {
  const [summaryResult, lineResult] = await Promise.all([
    supabase
      .from("summary_groups")
      .select("id,name")
      .eq("enabled", true)
      .order("name"),
    supabase
      .from("line_groups")
      .select("line_group_id,line_group_name,summary_group_id,reduction_pct")
      .eq("enabled", true)
      .order("line_group_name"),
  ]);

  if (summaryResult.error) throw summaryResult.error;
  if (lineResult.error) throw lineResult.error;

  return {
    summaryGroups: summaryResult.data ?? [],
    lineGroups: lineResult.data ?? [],
  };
}


export async function fetchDashboardFreshness({ businessDate, summaryGroupId = null, lineGroups = [] }) {
  const { startIso, endIso } = bangkokDayRange(businessDate);
  const matchingLineIds = summaryGroupId
    ? lineGroups.filter((g) => g.summary_group_id === summaryGroupId).map((g) => g.line_group_id)
    : lineGroups.map((g) => g.line_group_id);

  let webhookPromise;
  if (summaryGroupId && matchingLineIds.length === 0) {
    webhookPromise = Promise.resolve({ data: [], error: null });
  } else {
    let query = supabase
      .from("webhook_events")
      .select("received_at")
      .gte("received_at", startIso)
      .lt("received_at", endIso)
      .order("received_at", { ascending: false })
      .limit(1);
    if (matchingLineIds.length) query = query.in("line_group_id", matchingLineIds);
    webhookPromise = query;
  }

  let allocationQuery = supabase
    .from("allocation_confirmation_events")
    .select("confirmed_at")
    .eq("business_date", businessDate)
    .order("confirmed_at", { ascending: false })
    .limit(1);
  if (summaryGroupId) allocationQuery = allocationQuery.eq("summary_group_id", summaryGroupId);

  const [webhookResult, allocationResult, reviewResult, settingsResult] = await Promise.all([
    webhookPromise,
    allocationQuery,
    supabase
      .from("review_resolution_events")
      .select("resolved_at")
      .order("resolved_at", { ascending: false })
      .limit(1),
    supabase
      .from("settings_change_events")
      .select("changed_at")
      .order("changed_at", { ascending: false })
      .limit(1),
  ]);

  for (const result of [webhookResult, allocationResult, reviewResult, settingsResult]) {
    if (result.error) throw result.error;
  }

  const freshness = {
    webhook_at: webhookResult.data?.[0]?.received_at ?? null,
    allocation_at: allocationResult.data?.[0]?.confirmed_at ?? null,
    review_at: reviewResult.data?.[0]?.resolved_at ?? null,
    settings_at: settingsResult.data?.[0]?.changed_at ?? null,
  };
  freshness.version = [
    freshness.webhook_at ?? "",
    freshness.allocation_at ?? "",
    freshness.review_at ?? "",
    freshness.settings_at ?? "",
  ].join("|");
  return freshness;
}

export async function fetchOpenReviews(businessDate, summaryGroupId = null, settlementSessionId = null) {
  const MESSAGE_PAGE_SIZE = 500;
  const REVIEW_MESSAGE_CHUNK_SIZE = 100;
  const messages = [];

  for (let from = 0; ; from += MESSAGE_PAGE_SIZE) {
    let query = supabase
      .from("messages")
      .select(
        "id,business_date,settlement_session_id,summary_group_id,line_group_id,user_id,message_type,raw_text,normalized_text,ocr_text,parse_status,parser_version,image_storage_path,created_at"
      )
      .eq("business_date", businessDate)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + MESSAGE_PAGE_SIZE - 1);

    if (settlementSessionId) {
      query = query.eq(
        "settlement_session_id",
        settlementSessionId
      );
    }

    if (summaryGroupId) {
      query = query.eq(
        "summary_group_id",
        summaryGroupId
      );
    }

    const {
      data,
      error,
    } = await query;

    if (error) throw error;

    const page = data ?? [];

    messages.push(...page);

    if (page.length < MESSAGE_PAGE_SIZE) {
      break;
    }
  }

  if (!messages.length) return [];

  const messageById = new Map(
    messages.map((message) => [
      message.id,
      message,
    ])
  );

  const messageIds = [
    ...messageById.keys(),
  ];

  const reviews = [];

  for (
    let index = 0;
    index < messageIds.length;
    index += REVIEW_MESSAGE_CHUNK_SIZE
  ) {
    const ids = messageIds.slice(
      index,
      index + REVIEW_MESSAGE_CHUNK_SIZE
    );

    const {
      data,
      error,
    } = await supabase
      .from("review_items")
      .select(
        "id,message_record_id,reason_codes,warnings,status,created_at"
      )
      .eq("status", "OPEN")
      .in("message_record_id", ids);

    if (error) throw error;

    reviews.push(...(data ?? []));
  }

  reviews.sort((left, right) => {
    const timeDifference =
      Date.parse(right.created_at) -
      Date.parse(left.created_at);

    if (timeDifference) {
      return timeDifference;
    }

    return Number(right.id) -
      Number(left.id);
  });

  const {
    lineGroups,
  } = await loadGroupConfig();

  const lineNameById = new Map(
    lineGroups.map((group) => [
      group.line_group_id,
      group.line_group_name,
    ])
  );

  return reviews
    .map((review) => {
      const message = messageById.get(
        review.message_record_id
      );

      if (!message) return null;

      return {
        id: review.id,
        message_record_id:
          review.message_record_id,
        summary_group_id:
          message.summary_group_id,
        line_group_id:
          message.line_group_id,
        line_group_name:
          lineNameById.get(
            message.line_group_id
          ) ?? message.line_group_id,
        user_id: message.user_id,
        message_type: message.message_type,
        image_storage_path:
          message.image_storage_path ?? null,
        parse_status:
          message.parse_status,
        parser_version:
          message.parser_version,
        text:
          message.normalized_text ??
          message.ocr_text ??
          message.raw_text ??
          "",
        reason_codes:
          review.reason_codes ?? [],
        warnings:
          review.warnings ?? [],
        created_at:
          review.created_at,
      };
    })
    .filter(Boolean);
}


export async function fetchOpenReviewCount(
  businessDate,
  summaryGroupId = null,
  settlementSessionId = null
) {
  const MESSAGE_PAGE_SIZE = 1000;
  const REVIEW_MESSAGE_CHUNK_SIZE = 100;
  const REVIEW_COUNT_CONCURRENCY = 8;

  const messageIds = [];

  for (
    let from = 0;
    ;
    from += MESSAGE_PAGE_SIZE
  ) {
    let query = supabase
      .from("messages")
      .select("id")
      .eq("business_date", businessDate)
      .order("created_at", {
        ascending: false,
      })
      .order("id", {
        ascending: false,
      })
      .range(
        from,
        from + MESSAGE_PAGE_SIZE - 1
      );

    if (settlementSessionId) {
      query = query.eq(
        "settlement_session_id",
        settlementSessionId
      );
    }

    if (summaryGroupId) {
      query = query.eq(
        "summary_group_id",
        summaryGroupId
      );
    }

    const {
      data,
      error,
    } = await query;

    if (error) throw error;

    const page = data ?? [];

    messageIds.push(
      ...page.map((message) => message.id)
    );

    if (page.length < MESSAGE_PAGE_SIZE) {
      break;
    }
  }

  if (!messageIds.length) {
    return 0;
  }

  const chunks = [];

  for (
    let index = 0;
    index < messageIds.length;
    index += REVIEW_MESSAGE_CHUNK_SIZE
  ) {
    chunks.push(
      messageIds.slice(
        index,
        index + REVIEW_MESSAGE_CHUNK_SIZE
      )
    );
  }

  let total = 0;

  for (
    let index = 0;
    index < chunks.length;
    index += REVIEW_COUNT_CONCURRENCY
  ) {
    const batch = chunks.slice(
      index,
      index + REVIEW_COUNT_CONCURRENCY
    );

    const results = await Promise.all(
      batch.map((ids) =>
        supabase
          .from("review_items")
          .select(
            "id",
            {
              count: "exact",
              head: true,
            }
          )
          .eq("status", "OPEN")
          .in("message_record_id", ids)
      )
    );

    for (const result of results) {
      if (result.error) {
        throw result.error;
      }

      total += Number(
        result.count ?? 0
      );
    }
  }

  return total;
}

export async function fetchUnsends(businessDate, summaryGroupId = null) {
  const { startIso, endIso } = bangkokDayRange(businessDate);
  const { lineGroups } = await loadGroupConfig();
  const allowedLineIds = summaryGroupId
    ? new Set(lineGroups.filter((g) => g.summary_group_id === summaryGroupId).map((g) => g.line_group_id))
    : null;
  const lineNameById = new Map(lineGroups.map((g) => [g.line_group_id, g.line_group_name]));

  const { data, error } = await supabase
    .from("unsend_events")
    .select("id,message_id,line_group_id,user_id,matched_message_record_id,derived_qty_total,unsent_at,created_at")
    .gte("unsent_at", startIso)
    .lt("unsent_at", endIso)
    .order("unsent_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  return (data ?? [])
    .filter((row) => !allowedLineIds || allowedLineIds.has(row.line_group_id))
    .map((row) => ({
      ...row,
      line_group_name: lineNameById.get(row.line_group_id) ?? row.line_group_id,
    }));
}

export async function loadParserConfig() {
  const { data, error } = await supabase
    .from("category_aliases")
    .select("alias,canonical_category")
    .eq("enabled", true);
  if (error) throw error;

  const aliases = {};
  for (const row of data ?? []) aliases[row.alias] = row.canonical_category;
  return { aliases, defaultCategoryByCodeLength: { 2: "A", 3: "E" } };
}

export async function fetchCurrentSummaryGroupForLineGroup(lineGroupId) {
  const { data, error } = await supabase
    .from("line_groups")
    .select("summary_group_id")
    .eq("line_group_id", lineGroupId)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw error;
  if (!data?.summary_group_id) throw new Error("MESSAGE_GROUP_NOT_CONFIGURED");
  return data.summary_group_id;
}

export async function fetchOpenReviewById(reviewId) {
  const id = Number(reviewId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("INVALID_REVIEW_ID");

  const { data: review, error: reviewError } = await supabase
    .from("review_items")
    .select("id,message_record_id,reason_codes,warnings,status,created_at")
    .eq("id", id)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (!review) throw new Error("REVIEW_NOT_FOUND");
  if (review.status !== "OPEN") throw new Error("REVIEW_NOT_OPEN");

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .select("id,business_date,settlement_session_id,summary_group_id,line_group_id,user_id,message_type,raw_text,normalized_text,ocr_text,parse_status,unsent,created_at")
    .eq("id", review.message_record_id)
    .maybeSingle();
  if (messageError) throw messageError;
  if (!message) throw new Error("MESSAGE_NOT_FOUND");

  return { review, message };
}

export async function fetchSettings() {
  const [summaryResult, lineResult, allocationResult, aliasResult, profileResult, riskBudgetResult, categoryDefinitionResult, warehouseLimitResult, eventResult] = await Promise.all([
    supabase.from("summary_groups").select("id,name,enabled,created_at").order("name"),
    supabase.from("line_groups").select("line_group_id,line_group_name,summary_group_id,reduction_pct,enabled,created_at,updated_at").order("line_group_name"),
    supabase.from("allocation_rules").select("summary_group_id,category,threshold,destination,enabled,created_at,updated_at").order("summary_group_id").order("category"),
    supabase.from("category_aliases").select("alias,canonical_category,enabled,created_at").order("alias"),
    supabase.from("point_category_profiles").select("category,special_multiplier,max_special_codes,updated_at").order("category"),
    supabase.from("summary_group_risk_pool_settings").select("summary_group_id,risk_pool,point_loss_tolerance,updated_at").order("summary_group_id").order("risk_pool"),
    supabase.from("category_definitions").select("category,display_name,code_length,risk_pool,enabled,updated_at").eq("enabled",true).order("category"),
    supabase.from("warehouse_transfer_limits").select("destination,max_batch_quantity,enabled,updated_at").order("destination"),
    supabase.from("webhook_events").select("line_group_id,received_at").not("line_group_id", "is", null).order("received_at", { ascending: false }).limit(5000),
  ]);

  for (const result of [summaryResult, lineResult, allocationResult, aliasResult, profileResult, riskBudgetResult, categoryDefinitionResult, warehouseLimitResult, eventResult]) {
    if (result.error) throw result.error;
  }

  const configured = new Set((lineResult.data ?? []).map((row) => row.line_group_id));
  const latestByGroup = new Map();
  for (const row of eventResult.data ?? []) {
    if (!configured.has(row.line_group_id) && !latestByGroup.has(row.line_group_id)) {
      latestByGroup.set(row.line_group_id, row.received_at);
    }
  }

  return {
    summary_groups: summaryResult.data ?? [],
    line_groups: lineResult.data ?? [],
    allocation_rules: allocationResult.data ?? [],
    category_aliases: aliasResult.data ?? [],
    point_profiles: profileResult.data ?? [],
    risk_budgets: riskBudgetResult.data ?? [],
    category_definitions: categoryDefinitionResult.data ?? [],
    warehouse_limits: warehouseLimitResult.data ?? [],
    unconfigured_line_groups: [...latestByGroup.entries()].map(([line_group_id, last_seen_at]) => ({ line_group_id, last_seen_at })),
  };
}

export async function writeSettingsAudit({ entityType, entityKey, beforeData, afterData, changedBy }) {
  const { error } = await supabase.from("settings_change_events").insert({
    entity_type: entityType,
    entity_key: entityKey,
    action: "UPSERT",
    before_data: beforeData ?? null,
    after_data: afterData,
    changed_by: changedBy ?? "DASHBOARD",
  });
  if (error) throw error;
}

export async function fetchOpenSettlementSession() {
  const { data, error } = await supabase
    .from("settlement_sessions")
    .select("id,business_date,status,opened_at,closed_at,opened_by,closed_by")
    .eq("status", "OPEN")
    .maybeSingle();
  if (error) throw error;
  return data;
}
