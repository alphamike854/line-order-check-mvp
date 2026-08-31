import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";

const OPERATOR = process.env.DASHBOARD_OPERATOR_NAME || "DASHBOARD";

async function loadSummaryGroupStates(openSession) {
  if (!openSession?.id) return [];

  const [configResult, controlResult] =
    await Promise.all([
      supabase
        .from("settlement_line_group_config")
        .select("summary_group_id")
        .eq("settlement_session_id", openSession.id)
        .eq("enabled", true),

      supabase
        .from("settlement_summary_group_controls")
        .select(
          "summary_group_id,accepting_orders,changed_at,changed_by,closed_at",
        )
        .eq("settlement_session_id", openSession.id),
    ]);

  if (configResult.error) throw configResult.error;
  if (controlResult.error) throw controlResult.error;

  const controls = new Map(
    (controlResult.data ?? []).map(
      (row) => [row.summary_group_id, row],
    ),
  );

  const groupIds = [
    ...new Set(
      (configResult.data ?? [])
        .map((row) => row.summary_group_id)
        .filter(Boolean),
    ),
  ].sort();

  return groupIds.map((summaryGroupId) => {
    const control = controls.get(summaryGroupId);

    return {
      summary_group_id: summaryGroupId,
      accepting_orders:
        control?.accepting_orders !== false,
      changed_at: control?.changed_at ?? null,
      changed_by: control?.changed_by ?? null,
      closed_at: control?.closed_at ?? null,
    };
  });
}

async function getPayload() {
  const [{ data: open, error: openError }, { data: history, error: historyError }, {data: profiles,error:profilesError}] = await Promise.all([
    supabase.from("settlement_sessions").select("id,business_date,status,opened_at,closed_at,opened_by,closed_by").eq("status", "OPEN").maybeSingle(),
    supabase.from("settlement_sessions").select("id,business_date,status,opened_at,closed_at,opened_by,closed_by").eq("status", "CLOSED").order("closed_at", { ascending: false }).limit(50),
    supabase.from("point_category_profiles").select("category,special_multiplier,max_special_codes").order("category"),
  ]);
  if (openError) throw openError;
  if (historyError) throw historyError;
  if (profilesError) throw profilesError;

  let promotions = [];
  let openProfiles = [];
  let actualStatus = null;
  if (open?.id) {
    const [promoResult,profileResult,statusResult] = await Promise.all([
      supabase.from("settlement_point_promotions").select("category,code,point_factor_pct").eq("settlement_session_id",open.id).order("category").order("code"),
      supabase.from("settlement_point_profiles").select("category,special_multiplier,max_special_codes").eq("settlement_session_id",open.id).order("category"),
      supabase.from("session_actual_point_status").select("actual_codes_ready,category_counts").eq("settlement_session_id",open.id).maybeSingle(),
    ]);
    for(const r of [promoResult,profileResult,statusResult]) if(r.error) throw r.error;
    promotions=promoResult.data??[]; openProfiles=profileResult.data??[]; actualStatus=statusResult.data??null;
  }
  return {
    open_session: open ?? null,
    promotions,
    point_profiles:
      openProfiles.length
        ? openProfiles
        : (profiles ?? []),
    company_point_profiles: profiles ?? [],
    actual_point_status: actualStatus,
    summary_group_states:
      await loadSummaryGroupStates(open),
    closed_sessions: history ?? [],
  };
}

function mapError(message) {
  if (message.includes("SETTLEMENT_ALREADY_OPEN")) return [409, "SETTLEMENT_ALREADY_OPEN"];
  if (message.includes("SETTLEMENT_NOT_OPEN")) return [409, "SETTLEMENT_NOT_OPEN"];
  if (message.includes("SETTLEMENT_NOT_FOUND")) return [404, "SETTLEMENT_NOT_FOUND"];
  if (message.includes("SUMMARY_GROUP_NOT_IN_SETTLEMENT")) return [400, "SUMMARY_GROUP_NOT_IN_SETTLEMENT"];
  if (message.includes("SUMMARY_GROUP_REQUIRED")) return [400, "SUMMARY_GROUP_REQUIRED"];
  if (message.includes("SUMMARY_GROUP_STATE_REQUIRED")) return [400, "SUMMARY_GROUP_STATE_REQUIRED"];
  if (message.includes("SPECIAL_POINT_CODES_INCOMPLETE")) return [409, "SPECIAL_POINT_CODES_INCOMPLETE"];
  if (message.includes("INVALID_PROMOTION")) return [400, message.includes("CODE")?"INVALID_PROMOTION_CODE":"INVALID_PROMOTION_RULE"];
  return [500, message];
}

async function changeSummaryGroupState(
  body,
  acceptingOrders,
) {
  const sessionId =
    String(body.settlement_session_id ?? "");

  const summaryGroupId =
    String(body.summary_group_id ?? "").trim();

  if (!sessionId) {
    return json(
      { ok: false, error: "SETTLEMENT_NOT_FOUND" },
      400,
    );
  }

  if (!summaryGroupId) {
    return json(
      { ok: false, error: "SUMMARY_GROUP_REQUIRED" },
      400,
    );
  }

  const { data, error } = await supabase.rpc(
    "set_settlement_summary_group_accepting",
    {
      p_settlement_session_id: sessionId,
      p_summary_group_id: summaryGroupId,
      p_accepting_orders: acceptingOrders,
      p_changed_by: OPERATOR,
    },
  );

  if (error) {
    const [status, code] =
      mapError(error.message);

    return json(
      { ok: false, error: code },
      status,
    );
  }

  return json({
    ok: true,
    group_state: data,
    ...(await getPayload()),
  });
}

export default async (req) => {
  const denied = requireDashboardAccess(req);
  if (denied) return denied;
  try {
    if (req.method === "GET") return json({ ok: true, ...(await getPayload()) });
    if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    const body = await req.json();
    const action = String(body.action ?? "").toUpperCase();
    if (action === "OPEN_GROUP") {
      return changeSummaryGroupState(
        body,
        true,
      );
    }

    if (action === "CLOSE_GROUP") {
      return changeSummaryGroupState(
        body,
        false,
      );
    }

    if (action === "OPEN") {
      const businessDate = String(body.business_date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return json({ ok: false, error: "INVALID_BUSINESS_DATE" }, 400);

      // Fast path for a stale browser tab. The database RPC remains the final
      // concurrency guard, but returning the current session here lets the UI
      // recover without exposing a technical error code to the operator.
      const beforeOpen = await getPayload();
      if (beforeOpen.open_session?.id) {
        return json({
          ok: false,
          error: "SETTLEMENT_ALREADY_OPEN",
          user_message: "มียอดที่กำลังเปิดใช้งานอยู่ กรุณาปิดยอดปัจจุบันก่อนเปิดยอดใหม่",
          current_open_session: beforeOpen.open_session,
        }, 409);
      }

      const promotions = Array.isArray(body.promotions) ? body.promotions : [];
      const { data, error } = await supabase.rpc("open_settlement_session", { p_business_date: businessDate, p_promotions: promotions, p_opened_by: OPERATOR });
      if (error) {
        const [status, code] = mapError(error.message);
        if (code === "SETTLEMENT_ALREADY_OPEN") {
          const current = await getPayload();
          return json({
            ok: false,
            error: code,
            user_message: "มียอดที่กำลังเปิดใช้งานอยู่ กรุณาปิดยอดปัจจุบันก่อนเปิดยอดใหม่",
            current_open_session: current.open_session ?? null,
          }, status);
        }
        return json({ ok: false, error: code }, status);
      }
      return json({ ok: true, settlement_session_id: data, ...(await getPayload()) });
    }
    if (action === "CLOSE") {
      const sessionId = String(body.settlement_session_id ?? "");
      const { data, error } = await supabase.rpc("close_settlement_session", { p_session_id: sessionId, p_closed_by: OPERATOR });
      if (error) { const [status, code] = mapError(error.message); return json({ ok: false, error: code }, status); }
      return json({ ok: true, closed: data, ...(await getPayload()) });
    }
    return json({ ok: false, error: "INVALID_SETTLEMENT_ACTION" }, 400);
  } catch (error) {
    console.error("settlement failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};
export const config = { path: "/api/settlement" };
