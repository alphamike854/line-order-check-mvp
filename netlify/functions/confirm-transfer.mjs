import {
  json,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";
import { verifyAllocationConfirmationToken } from "../../src/lib/allocation-safety.mjs";

const OPERATOR = process.env.DASHBOARD_OPERATOR_NAME || "DASHBOARD";

function mappedRpcError(error) {
  const message = String(error?.message ?? "");
  if (message.includes("ALLOCATION_STALE")) return ["ALLOCATION_STALE", 409];
  if (message.includes("NO_TRANSFER_REQUIRED")) return ["NO_TRANSFER_REQUIRED", 409];
  if (message.includes("ALLOCATION_STATE_NOT_FOUND")) return ["ALLOCATION_STATE_NOT_FOUND", 404];
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const verified = verifyAllocationConfirmationToken({ token: body.confirmation_token });
    if (!verified.ok) {
      const status = verified.error === "CONFIRMATION_EXPIRED" ? 409 : 400;
      return json({ ok: false, error: verified.error }, status);
    }

    const s = verified.snapshot;
    const { data, error } = await supabase.rpc("confirm_allocation_transfer_safe", {
      p_request_id: verified.request_id,
      p_business_date: s.business_date,
      p_summary_group_id: s.summary_group_id,
      p_category: s.category,
      p_code: s.code,
      p_expected_order_total: s.order_total,
      p_expected_threshold: s.threshold,
      p_expected_destination: s.destination,
      p_expected_should_transfer: s.should_transfer,
      p_expected_confirmed_transfer: s.confirmed_transfer,
      p_expected_transfer_now: s.transfer_now,
      p_confirmed_by: OPERATOR,
    });

    if (error) {
      const mapped = mappedRpcError(error);
      if (mapped) return json({ ok: false, error: mapped[0] }, mapped[1]);
      throw error;
    }

    return json({ ok: true, allocation: data });
  } catch (error) {
    console.error("confirm-transfer failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};

export const config = { path: "/api/confirm-transfer" };
