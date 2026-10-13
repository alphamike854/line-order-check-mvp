import {
  json,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

export default async function handler(req) {
  const denied = requireDashboardAccess(req);
  if (denied) return denied;
  if (req.method !== "GET") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const summaryGroupId = String(
    new URL(req.url).searchParams.get("summary_group_id") || "",
  ).trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(summaryGroupId)) {
    return json({ ok: false, error: "INVALID_SUMMARY_GROUP" }, 400);
  }
  try {
    const { data: cursor, error: cursorError } = await supabase
      .from("summary_group_round_runtime_state")
      .select("latest_round_id")
      .eq("summary_group_id", summaryGroupId)
      .maybeSingle();
    if (cursorError) throw cursorError;
    if (!cursor) {
      return json({ ok: true, summary_group_id: summaryGroupId,
        round_status: "NOT_STARTED" });
    }
    const { data: round, error: roundError } = await supabase
      .from("settlement_summary_group_rounds")
      .select("id,settlement_session_id,status,business_date,daily_round_no,opened_at")
      .eq("id", cursor.latest_round_id)
      .maybeSingle();
    if (roundError) throw roundError;
    if (!round) {
      return json({ ok: false, error: "ROUND_CURSOR_MISSING" }, 503);
    }
    return json({
      ok: true,
      summary_group_id: summaryGroupId,
      round_id: round.id,
      settlement_session_id: round.settlement_session_id,
      round_status: round.status,
      business_date: round.business_date,
      daily_round_no: round.daily_round_no,
      opened_at: round.opened_at,
    });
  } catch (error) {
    console.error("round-open-status read failed", error);
    return json({ ok: false, error: "ROUND_STATUS_UNAVAILABLE" }, 503);
  }
}

export const config = { path: "/api/round-open-status", region: "sin" };
