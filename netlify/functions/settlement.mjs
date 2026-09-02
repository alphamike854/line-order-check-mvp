import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";

const OPERATOR = process.env.DASHBOARD_OPERATOR_NAME || "DASHBOARD";

async function loadSummaryGroupStates(openSession) {
  if (!openSession?.id) return [];

  const [configResult, roundResult] =
    await Promise.all([
      supabase
        .from("settlement_line_group_config")
        .select("summary_group_id")
        .eq("settlement_session_id", openSession.id)
        .eq("enabled", true),

      supabase
        .from("settlement_summary_group_rounds")
        .select(
          [
            "id",
            "summary_group_id",
            "round_no",
            "status",
            "opened_at",
            "opened_by",
            "closed_at",
            "closed_by",
            "updated_at",
          ].join(","),
        )
        .eq("settlement_session_id", openSession.id)
        .order("round_no", { ascending: false }),
    ]);

  if (configResult.error) throw configResult.error;
  if (roundResult.error) throw roundResult.error;

  const roundsByGroup = new Map();

  for (const row of roundResult.data ?? []) {
    if (!row?.summary_group_id) continue;

    const rows =
      roundsByGroup.get(row.summary_group_id)
      ?? [];

    rows.push(row);
    roundsByGroup.set(row.summary_group_id, rows);
  }

  const groupIds = [
    ...new Set(
      (configResult.data ?? [])
        .map((row) => row.summary_group_id)
        .filter(Boolean),
    ),
  ].sort();

  return groupIds.map((summaryGroupId) => {
    const rounds =
      roundsByGroup.get(summaryGroupId)
      ?? [];

    const openRound =
      rounds.find(
        (row) => row.status === "OPEN",
      )
      ?? null;

    const latestRound =
      rounds[0]
      ?? null;

    const acceptingOrders =
      Boolean(openRound);

    return {
      summary_group_id: summaryGroupId,

      accepting_orders:
        acceptingOrders,

      has_previous_round:
        Boolean(latestRound),

      round_id:
        openRound?.id
        ?? latestRound?.id
        ?? null,

      round_no:
        openRound?.round_no
        ?? latestRound?.round_no
        ?? null,

      round_status:
        openRound
          ? "OPEN"
          : latestRound?.status
            ?? "NOT_STARTED",

      changed_at:
        openRound?.opened_at
        ?? latestRound?.closed_at
        ?? latestRound?.updated_at
        ?? null,

      changed_by:
        openRound?.opened_by
        ?? latestRound?.closed_by
        ?? null,

      closed_at:
        acceptingOrders
          ? null
          : latestRound?.closed_at
            ?? null,
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
      supabase.from("settlement_point_promotions").select("summary_group_id,category,code,point_factor_pct,updated_at,updated_by").eq("settlement_session_id",open.id).order("category").order("code"),
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

  const cleanupPaths =
    acceptingOrders
    && Array.isArray(data?.image_storage_paths)
      ? data.image_storage_paths.filter(Boolean)
      : [];

  let imageCleanup = {
    requested: cleanupPaths.length,
    deleted: 0,
    pending: 0,
  };

  if (
    cleanupPaths.length
    && data?.reset_from_round_id
  ) {
    const bucket =
      String(
        data.image_storage_bucket
        || "review-images",
      );

    const attemptedAt =
      new Date().toISOString();

    const { error: removeError } =
      await supabase.storage
        .from(bucket)
        .remove(cleanupPaths);

    if (removeError) {
      console.error(
        "round reset image cleanup failed",
        removeError,
      );

      imageCleanup.pending =
        cleanupPaths.length;

      const { error: queueError } =
        await supabase
          .from(
            "settlement_round_storage_cleanup_queue",
          )
          .update({
            status: "FAILED",
            attempted_at: attemptedAt,
            last_error:
              String(
                removeError.message
                ?? removeError,
              ).slice(0, 1000),
          })
          .eq(
            "round_id",
            data.reset_from_round_id,
          )
          .in(
            "storage_path",
            cleanupPaths,
          );

      if (queueError) {
        console.error(
          "round reset cleanup queue update failed",
          queueError,
        );
      }
    } else {
      imageCleanup.deleted =
        cleanupPaths.length;

      const { error: queueError } =
        await supabase
          .from(
            "settlement_round_storage_cleanup_queue",
          )
          .update({
            status: "DELETED",
            attempted_at: attemptedAt,
            deleted_at: attemptedAt,
            last_error: null,
          })
          .eq(
            "round_id",
            data.reset_from_round_id,
          )
          .in(
            "storage_path",
            cleanupPaths,
          );

      if (queueError) {
        console.error(
          "round reset cleanup queue update failed",
          queueError,
        );
      }
    }
  }

  return json({
    ok: true,
    group_state: data,
    image_cleanup: imageCleanup,
    ...(await getPayload()),
  });
}

async function changePointPromotion(
  body,
  deleting = false,
) {
  const sessionId =
    String(
      body.settlement_session_id ?? "",
    );

  const summaryGroupId =
    String(
      body.summary_group_id ?? "",
    ).trim();

  const category =
    String(
      body.category ?? "",
    ).trim().toUpperCase();

  const code =
    String(
      body.code ?? "",
    ).trim();

  if (!sessionId) {
    return json(
      {
        ok: false,
        error: "SETTLEMENT_NOT_FOUND",
      },
      400,
    );
  }

  if (!summaryGroupId) {
    return json(
      {
        ok: false,
        error: "SUMMARY_GROUP_REQUIRED",
      },
      400,
    );
  }

  if (!category || !code) {
    return json(
      {
        ok: false,
        error: "INVALID_PROMOTION_RULE",
      },
      400,
    );
  }

  let rpc;
  let args;

  if (deleting) {
    rpc =
      "delete_settlement_summary_group_point_promotion";

    args = {
      p_settlement_session_id:
        sessionId,
      p_summary_group_id:
        summaryGroupId,
      p_category:
        category,
      p_code:
        code,
      p_changed_by:
        OPERATOR,
    };
  } else {
    const factor =
      Number(
        body.point_factor_pct,
      );

    if (
      !Number.isFinite(factor)
      || factor < 0
      || factor > 100
    ) {
      return json(
        {
          ok: false,
          error:
            "INVALID_PROMOTION_RULE",
        },
        400,
      );
    }

    rpc =
      "set_settlement_summary_group_point_promotion";

    args = {
      p_settlement_session_id:
        sessionId,
      p_summary_group_id:
        summaryGroupId,
      p_category:
        category,
      p_code:
        code,
      p_point_factor_pct:
        factor,
      p_changed_by:
        OPERATOR,
    };
  }

  const { data, error } =
    await supabase.rpc(
      rpc,
      args,
    );

  if (error) {
    const [status, errorCode] =
      mapError(
        error.message,
      );

    return json(
      {
        ok: false,
        error: errorCode,
      },
      status,
    );
  }

  return json({
    ok: true,
    promotion_change:
      data,
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

    if (action === "SET_PROMOTION") {
      return changePointPromotion(
        body,
        false,
      );
    }

    if (action === "DELETE_PROMOTION") {
      return changePointPromotion(
        body,
        true,
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
