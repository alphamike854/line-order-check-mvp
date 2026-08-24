import {
  fetchDashboardFreshness,
  json,
  loadGroupConfig,
  normalizeBusinessDate,
  normalizeSummaryGroup,
  requireDashboardAccess,
} from "../../src/lib/dashboard-api.mjs";

export default async (req) => {
  if (req.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const businessDate = normalizeBusinessDate(url.searchParams.get("date"));
    const summaryGroupId = normalizeSummaryGroup(url.searchParams.get("group"));
    const { lineGroups } = await loadGroupConfig();
    const freshness = await fetchDashboardFreshness({ businessDate, summaryGroupId, lineGroups });
    return json({ ok: true, business_date: businessDate, selected_summary_group: summaryGroupId ?? "ALL", freshness });
  } catch (error) {
    console.error("dashboard-freshness failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};

export const config = { path: "/api/dashboard-freshness" };
