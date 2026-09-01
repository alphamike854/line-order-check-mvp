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
    };
  }

  if (!summaryGroups.includes(selectedSummaryGroup)) {
    throw new Error(
      "SUMMARY_GROUP_NOT_IN_SETTLEMENT",
    );
  }

  const [
    promoResult,
    codeResult,
    statusResult,
  ] = await Promise.all([
    supabase
      .from("settlement_point_promotions")
      .select(
        "summary_group_id,category,code,point_factor_pct",
      )
      .eq("settlement_session_id", session.id)
      .eq(
        "summary_group_id",
        selectedSummaryGroup,
      )
      .order("category")
      .order("code"),

    supabase
      .from(
        "settlement_summary_group_actual_special_point_codes",
      )
      .select(
        "summary_group_id,category,code,created_at",
      )
      .eq("settlement_session_id", session.id)
      .eq(
        "summary_group_id",
        selectedSummaryGroup,
      )
      .order("category")
      .order("code"),

    supabase
      .from(
        "session_summary_group_actual_point_status",
      )
      .select(
        "summary_group_id,actual_codes_ready,category_counts",
      )
      .eq("settlement_session_id", session.id)
      .eq(
        "summary_group_id",
        selectedSummaryGroup,
      )
      .maybeSingle(),
  ]);

  for (
    const result of [
      promoResult,
      codeResult,
      statusResult,
    ]
  ) {
    if (result.error) throw result.error;
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
    codes: codeResult.data ?? [],
    status: statusResult.data ?? null,
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
