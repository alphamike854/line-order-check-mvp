import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { bangkokDayRange } from "./dashboard-utils.mjs";

export { bangkokToday, normalizeBusinessDate, bangkokDayRange, normalizeSummaryGroup } from "./dashboard-utils.mjs";

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

export async function loadGroupConfig() {
  const [summaryResult, lineResult] = await Promise.all([
    supabase
      .from("summary_groups")
      .select("id,name")
      .eq("enabled", true)
      .order("name"),
    supabase
      .from("line_groups")
      .select("line_group_id,line_group_name,summary_group_id")
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

export async function fetchOpenReviews(businessDate, summaryGroupId = null) {
  const { data: reviews, error: reviewError } = await supabase
    .from("review_items")
    .select("id,message_record_id,reason_codes,warnings,status,created_at")
    .eq("status", "OPEN")
    .order("created_at", { ascending: false })
    .limit(250);
  if (reviewError) throw reviewError;

  const ids = [...new Set((reviews ?? []).map((r) => r.message_record_id).filter(Boolean))];
  if (!ids.length) return [];

  const { data: messages, error: messageError } = await supabase
    .from("messages")
    .select("id,business_date,summary_group_id,line_group_id,user_id,message_type,raw_text,normalized_text,ocr_text,parse_status,created_at")
    .in("id", ids);
  if (messageError) throw messageError;

  const messageById = new Map((messages ?? []).map((m) => [m.id, m]));
  const { lineGroups } = await loadGroupConfig();
  const lineNameById = new Map(lineGroups.map((g) => [g.line_group_id, g.line_group_name]));

  return (reviews ?? [])
    .map((review) => {
      const message = messageById.get(review.message_record_id);
      if (!message) return null;
      if (message.business_date !== businessDate) return null;
      if (summaryGroupId && message.summary_group_id !== summaryGroupId) return null;
      return {
        id: review.id,
        message_record_id: review.message_record_id,
        summary_group_id: message.summary_group_id,
        line_group_id: message.line_group_id,
        line_group_name: lineNameById.get(message.line_group_id) ?? message.line_group_id,
        user_id: message.user_id,
        message_type: message.message_type,
        parse_status: message.parse_status,
        text: message.normalized_text ?? message.ocr_text ?? message.raw_text ?? "",
        reason_codes: review.reason_codes ?? [],
        warnings: review.warnings ?? [],
        created_at: review.created_at,
      };
    })
    .filter(Boolean);
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
