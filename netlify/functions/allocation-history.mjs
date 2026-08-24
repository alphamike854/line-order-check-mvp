import {
  json,
  normalizeBusinessDate,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

export default async (req) => {
  if (req.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const businessDate = normalizeBusinessDate(url.searchParams.get("date"));
    const summaryGroupId = normalizeSummaryGroup(url.searchParams.get("group"));

    let query = supabase
      .from("allocation_confirmation_events")
      .select("id,request_id,business_date,summary_group_id,category,code,previous_confirmed,new_confirmed,delta_confirmed,order_total,threshold,destination,should_transfer,confirmed_by,confirmed_at")
      .eq("business_date", businessDate)
      .order("confirmed_at", { ascending: false })
      .limit(200);
    if (summaryGroupId) query = query.eq("summary_group_id", summaryGroupId);

    const { data, error } = await query;
    if (error) throw error;

    return json({ ok: true, business_date: businessDate, selected_summary_group: summaryGroupId ?? "ALL", items: data ?? [] });
  } catch (error) {
    console.error("allocation-history failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};

export const config = { path: "/api/allocation-history" };
