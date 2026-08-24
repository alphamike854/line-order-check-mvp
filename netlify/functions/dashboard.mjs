import {
  bangkokDayRange,
  fetchOpenReviews,
  fetchUnsends,
  json,
  loadGroupConfig,
  normalizeBusinessDate,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

export default async (req) => {
  if (req.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const businessDate = normalizeBusinessDate(url.searchParams.get("date"));
    const summaryGroupId = normalizeSummaryGroup(url.searchParams.get("group"));
    const { summaryGroups, lineGroups } = await loadGroupConfig();

    let summaryQuery = supabase
      .from("current_summary")
      .select("business_date,summary_group_id,category,code,order_total,unsent_qty,active_equivalent,last_updated")
      .eq("business_date", businessDate)
      .order("category")
      .order("code");
    if (summaryGroupId) summaryQuery = summaryQuery.eq("summary_group_id", summaryGroupId);

    let allocationQuery = supabase
      .from("allocation_state")
      .select("business_date,summary_group_id,category,code,order_total,threshold,destination,should_transfer,confirmed_transfer,transfer_now,status")
      .eq("business_date", businessDate)
      .order("category")
      .order("code");
    if (summaryGroupId) allocationQuery = allocationQuery.eq("summary_group_id", summaryGroupId);

    let messagesQuery = supabase
      .from("messages")
      .select("parse_status,created_at")
      .eq("business_date", businessDate)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (summaryGroupId) messagesQuery = messagesQuery.eq("summary_group_id", summaryGroupId);

    const { startIso, endIso } = bangkokDayRange(businessDate);
    const matchingLineIds = summaryGroupId
      ? lineGroups.filter((g) => g.summary_group_id === summaryGroupId).map((g) => g.line_group_id)
      : lineGroups.map((g) => g.line_group_id);

    let latestEventQuery = supabase
      .from("webhook_events")
      .select("received_at,event_type,line_group_id")
      .gte("received_at", startIso)
      .lt("received_at", endIso)
      .order("received_at", { ascending: false })
      .limit(1);
    if (matchingLineIds.length) latestEventQuery = latestEventQuery.in("line_group_id", matchingLineIds);

    const [summaryResult, allocationResult, messagesResult, latestEventResult, reviews, unsends] = await Promise.all([
      summaryQuery,
      allocationQuery,
      messagesQuery,
      latestEventQuery,
      fetchOpenReviews(businessDate, summaryGroupId),
      fetchUnsends(businessDate, summaryGroupId),
    ]);

    if (summaryResult.error) throw summaryResult.error;
    if (allocationResult.error) throw allocationResult.error;
    if (messagesResult.error) throw messagesResult.error;
    if (latestEventResult.error) throw latestEventResult.error;

    const summary = summaryResult.data ?? [];
    const allocation = allocationResult.data ?? [];
    const messages = messagesResult.data ?? [];

    const parsedCount = messages.filter((m) => m.parse_status === "PARSED").length;
    const pendingCount = messages.filter((m) => m.parse_status === "PENDING").length;

    return json({
      ok: true,
      business_date: businessDate,
      selected_summary_group: summaryGroupId ?? "ALL",
      summary_groups: summaryGroups,
      metrics: {
        messages_total: messages.length,
        parsed: parsedCount,
        pending: pendingCount,
        review_open: reviews.length,
        unsend_count: unsends.length,
        order_total: sum(summary, "order_total"),
        unsent_qty: sum(summary, "unsent_qty"),
        active_equivalent: sum(summary, "active_equivalent"),
        transfer_now_total: sum(allocation, "transfer_now"),
        transfer_required_codes: allocation.filter((r) => Number(r.transfer_now) > 0).length,
        last_event_at: latestEventResult.data?.[0]?.received_at ?? messages[0]?.created_at ?? null,
      },
      summary,
      allocation,
    });
  } catch (error) {
    console.error("dashboard failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};

export const config = { path: "/api/dashboard" };
