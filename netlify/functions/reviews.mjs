import {
  fetchOpenReviews,
  json,
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
    const items = await fetchOpenReviews(businessDate, summaryGroupId);
    return json({ ok: true, business_date: businessDate, items });
  } catch (error) {
    console.error("reviews failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};

export const config = { path: "/api/reviews" };
