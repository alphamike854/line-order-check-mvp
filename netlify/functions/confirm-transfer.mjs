import {
  json,
  normalizeBusinessDate,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

const OPERATOR = process.env.DASHBOARD_OPERATOR_NAME || "DASHBOARD";

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const businessDate = normalizeBusinessDate(body.business_date);
    const summaryGroupId = String(body.summary_group_id ?? "").trim();
    const category = String(body.category ?? "").trim().toUpperCase();
    const code = String(body.code ?? "").trim();

    if (!summaryGroupId || !["A", "B", "E", "F", "G"].includes(category) || !code) {
      return json({ ok: false, error: "INVALID_CONFIRMATION_INPUT" }, 400);
    }

    const { data, error } = await supabase.rpc("confirm_allocation_transfer", {
      p_business_date: businessDate,
      p_summary_group_id: summaryGroupId,
      p_category: category,
      p_code: code,
      p_confirmed_by: OPERATOR,
    });

    if (error) {
      if (String(error.message).includes("NO_TRANSFER_REQUIRED")) {
        return json({ ok: false, error: "NO_TRANSFER_REQUIRED" }, 409);
      }
      if (String(error.message).includes("ALLOCATION_STATE_NOT_FOUND")) {
        return json({ ok: false, error: "ALLOCATION_STATE_NOT_FOUND" }, 404);
      }
      throw error;
    }

    return json({ ok: true, allocation: data });
  } catch (error) {
    console.error("confirm-transfer failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};

export const config = { path: "/api/confirm-transfer" };
