import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";

function normalizeSummaryGroup(value = "") {
  const text = String(value || "").trim();
  return text && text !== "ALL" ? text : null;
}

async function resolveSession(explicitId = "") {
  const id = String(explicitId || "").trim();

  if (id) {
    const { data, error } = await supabase
      .from("settlement_sessions")
      .select("id,business_date,status,opened_at,closed_at")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data ?? null;
  }

  const { data, error } = await supabase
    .from("settlement_sessions")
    .select("id,business_date,status,opened_at,closed_at")
    .eq("status", "OPEN")
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function summaryGroupsForSession(sessionId) {
  const { data, error } = await supabase
    .from("settlement_line_group_config")
    .select("summary_group_id")
    .eq("settlement_session_id", sessionId)
    .order("summary_group_id");

  if (error) throw error;

  return [
    ...new Set(
      (data ?? [])
        .map((row) => String(row.summary_group_id || "").trim())
        .filter(Boolean),
    ),
  ];
}

async function resolvePointRoundRead(
  sessionId,
  summaryGroupId,
) {
  const { data, error } = await supabase
    .from("settlement_summary_group_rounds")
    .select("id,round_no,status")
    .eq("settlement_session_id", sessionId)
    .eq("summary_group_id", summaryGroupId)
    .in("status", ["OPEN", "CLOSED"])
    .order("round_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      mode: "LEGACY_NO_ROUND",
      round: null,
    };
  }

  const {
    data: snapshot,
    error: snapshotError,
  } = await supabase
    .from("settlement_summary_group_round_snapshots")
    .select("round_id")
    .eq("round_id", data.id)
    .maybeSingle();

  if (snapshotError) throw snapshotError;

  if (snapshot) {
    throw new Error(
      "CURRENT_ROUND_ARCHIVED",
    );
  }

  return {
    mode: "ROUND",
    round: data,
  };
}

async function pointPayload(
  session,
  explicitSummaryGroupId = "",
) {
  if (!session) {
    return {
      session: null,
      open_session: null,
      summary_groups: [],
      selected_summary_group: null,
      profiles: [],
      promotions: [],
      codes: [],
      status: null,
      round_id: null,
      round_no: null,
      round_status: null,
      eligible_line_groups: [],
    };
  }

  const [
    summaryGroups,
    profileResult,
  ] = await Promise.all([
    summaryGroupsForSession(session.id),
    supabase
      .from("settlement_point_profiles")
      .select(
        "category,special_multiplier,max_special_codes",
      )
      .eq("settlement_session_id", session.id)
      .order("category"),
  ]);

  if (profileResult.error) {
    throw profileResult.error;
  }

  const selectedSummaryGroup =
    normalizeSummaryGroup(explicitSummaryGroupId);

  if (!selectedSummaryGroup) {
    return {
      session,
      open_session:
        session.status === "OPEN" ? session : null,
      summary_groups: summaryGroups,
      selected_summary_group: null,
      profiles: profileResult.data ?? [],
      promotions: [],
      codes: [],
      status: null,
      round_id: null,
      round_no: null,
      round_status: null,
      eligible_line_groups: [],
    };
  }

  if (!summaryGroups.includes(selectedSummaryGroup)) {
    throw new Error(
      "SUMMARY_GROUP_NOT_IN_SETTLEMENT",
    );
  }

  const roundRead =
    await resolvePointRoundRead(
      session.id,
      selectedSummaryGroup,
    );

  const useRoundRead =
    roundRead.mode === "ROUND";

  const promotionSource = useRoundRead
    ? "settlement_summary_group_point_promotions_current"
    : "settlement_point_promotions";

  const promotionSelect = useRoundRead
    ? [
        "summary_group_id",
        "round_id",
        "round_no",
        "round_status",
        "promotion_id",
        "category",
        "code",
        "point_factor_pct",
        "target_scope",
        "line_group_ids",
        "updated_at",
        "updated_by",
      ].join(",")
    : "summary_group_id,category,code,point_factor_pct";

  const codeSource = useRoundRead
    ? "settlement_summary_group_actual_special_point_codes_current"
    : "settlement_summary_group_actual_special_point_codes";

  const statusSource = useRoundRead
    ? "session_summary_group_actual_point_status_current"
    : "session_summary_group_actual_point_status";

  const codeSelect = useRoundRead
    ? "summary_group_id,round_id,round_no,round_status,category,code,created_at,updated_at,updated_by"
    : "summary_group_id,category,code,created_at";

  const statusSelect = useRoundRead
    ? "summary_group_id,round_id,round_no,round_status,actual_codes_ready,category_counts"
    : "summary_group_id,actual_codes_ready,category_counts";

  const [
    promoResult,
    codeResult,
    statusResult,
    eligibleLineGroupResult,
  ] = await Promise.all([
    supabase
      .from(promotionSource)
      .select(promotionSelect)
      .eq("settlement_session_id", session.id)
      .eq(
        "summary_group_id",
        selectedSummaryGroup,
      )
      .order("category")
      .order("code"),

    supabase
      .from(codeSource)
      .select(codeSelect)
      .eq("settlement_session_id", session.id)
      .eq(
        "summary_group_id",
        selectedSummaryGroup,
      )
      .order("category")
      .order("code"),

    supabase
      .from(statusSource)
      .select(statusSelect)
      .eq("settlement_session_id", session.id)
      .eq(
        "summary_group_id",
        selectedSummaryGroup,
      )
      .maybeSingle(),

    supabase
      .from("settlement_line_group_config")
      .select("line_group_id,line_group_name")
      .eq("settlement_session_id", session.id)
      .eq(
        "summary_group_id",
        selectedSummaryGroup,
      )
      .eq("enabled", true)
      .order("line_group_name")
      .order("line_group_id"),
  ]);

  for (
    const result of [
      promoResult,
      codeResult,
      statusResult,
      eligibleLineGroupResult,
    ]
  ) {
    if (result.error) throw result.error;
  }

  if (useRoundRead) {
    const expectedRoundId =
      roundRead.round?.id ?? null;

    if (
      (promoResult.data ?? []).some(
        (row) =>
          row.round_id !== expectedRoundId,
      )
    ) {
      throw new Error(
        "ROUND_PROMOTION_PROJECTION_MISMATCH",
      );
    }

    for (
      const promotion of
      promoResult.data ?? []
    ) {
      const targetScope =
        promotion.target_scope;

      const lineGroupIds =
        Array.isArray(
          promotion.line_group_ids,
        )
          ? promotion.line_group_ids
          : null;

      if (
        !["ALL", "SELECTED"].includes(
          targetScope,
        )
        || !lineGroupIds
        || (
          targetScope === "ALL"
          && lineGroupIds.length !== 0
        )
        || (
          targetScope === "SELECTED"
          && lineGroupIds.length === 0
        )
      ) {
        throw new Error(
          "ROUND_PROMOTION_TARGET_MISMATCH",
        );
      }
    }

    if (
      !statusResult.data
      || statusResult.data.round_id !==
        expectedRoundId
    ) {
      throw new Error(
        "ROUND_READ_PROJECTION_MISMATCH",
      );
    }

    if (
      (codeResult.data ?? []).some(
        (row) =>
          row.round_id !== expectedRoundId,
      )
    ) {
      throw new Error(
        "ROUND_CODE_PROJECTION_MISMATCH",
      );
    }
  }

  return {
    session,
    open_session:
      session.status === "OPEN" ? session : null,
    summary_groups: summaryGroups,
    selected_summary_group:
      selectedSummaryGroup,
    profiles: profileResult.data ?? [],
    promotions: promoResult.data ?? [],
    eligible_line_groups:
      eligibleLineGroupResult.data ?? [],
    codes: codeResult.data ?? [],
    status: statusResult.data ?? null,
    round_id: roundRead.round?.id ?? null,
    round_no: roundRead.round?.round_no ?? null,
    round_status: roundRead.round?.status ?? null,
  };
}

export default async (req) => {
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);

      const session = await resolveSession(
        url.searchParams.get("session_id") || "",
      );

      const summaryGroupId =
        url.searchParams.get("group") || "";

      return json({
        ok: true,
        ...(await pointPayload(
          session,
          summaryGroupId,
        )),
      });
    }

    if (req.method !== "POST") {
      return json(
        {
          ok: false,
          error: "METHOD_NOT_ALLOWED",
        },
        405,
      );
    }

    const body = await req.json();

    const session = await resolveSession(
      body.settlement_session_id || "",
    );

    if (!session) {
      return json(
        {
          ok: false,
          error: "SETTLEMENT_NOT_FOUND",
        },
        404,
      );
    }

    const summaryGroupId =
      normalizeSummaryGroup(
        body.summary_group_id,
      );

    if (!summaryGroupId) {
      return json(
        {
          ok: false,
          error: "SUMMARY_GROUP_REQUIRED",
        },
        400,
      );
    }

    const codes =
      Array.isArray(body.codes)
        ? body.codes
        : [];

    const { data, error } =
      await supabase.rpc(
        "replace_settlement_summary_group_actual_special_codes",
        {
          p_session_id: session.id,
          p_summary_group_id:
            summaryGroupId,
          p_codes: codes,
        },
      );

    if (error) {
      const message =
        String(error.message ?? "");

      if (
        message.includes(
          "SETTLEMENT_NOT_FOUND",
        )
      ) {
        return json(
          {
            ok: false,
            error: "SETTLEMENT_NOT_FOUND",
          },
          404,
        );
      }

      if (
        message.includes(
          "SETTLEMENT_NOT_EDITABLE",
        )
      ) {
        return json(
          {
            ok: false,
            error: "SETTLEMENT_NOT_EDITABLE",
          },
          409,
        );
      }

      if (
        message.includes(
          "SUMMARY_GROUP_NOT_IN_SETTLEMENT",
        )
      ) {
        return json(
          {
            ok: false,
            error:
              "SUMMARY_GROUP_NOT_IN_SETTLEMENT",
          },
          400,
        );
      }

      if (
        message.includes(
          "SPECIAL_POINT_LIMIT_",
        )
      ) {
        return json(
          {
            ok: false,
            error:
              message.match(
                /SPECIAL_POINT_LIMIT_[A-Z]/,
              )?.[0]
              ?? "SPECIAL_POINT_LIMIT",
          },
          400,
        );
      }

      if (
        message.includes("DUPLICATE_POINT_CODE")
      ) {
        return json(
          {
            ok: false,
            error: "DUPLICATE_POINT_CODE",
          },
          400,
        );
      }

      if (
        message.includes("INVALID_POINT")
      ) {
        return json(
          {
            ok: false,
            error: "INVALID_POINT_CODE",
          },
          400,
        );
      }

      throw error;
    }

    return json({
      ok: true,
      count: data,
      ...(await pointPayload(
        session,
        summaryGroupId,
      )),
    });
  } catch (error) {
    if (
      error?.message ===
      "SUMMARY_GROUP_NOT_IN_SETTLEMENT"
    ) {
      return json(
        {
          ok: false,
          error:
            "SUMMARY_GROUP_NOT_IN_SETTLEMENT",
        },
        400,
      );
    }

    console.error(
      "special-points failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error?.message ?? String(error),
      },
      500,
    );
  }
};

export const config = {
  path: "/api/special-points",
};
