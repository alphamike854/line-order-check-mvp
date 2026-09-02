function numeric(value) {
  const parsed =
    Number(value ?? 0);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

export function normalizeWorkbenchLimit(
  value,
) {
  if (
    value === null
    || value === undefined
    || String(value).trim() === ""
  ) {
    return 100;
  }

  const parsed =
    Number(value);

  if (!Number.isInteger(parsed)) {
    return 100;
  }

  return Math.max(
    1,
    Math.min(
      parsed,
      200,
    ),
  );
}

export function normalizeWorkbenchOffset(
  value,
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed)
    || parsed < 0
  ) {
    return 0;
  }

  return parsed;
}


export async function loadActorSessionLineGroupIds(
  client,
  actor,
  settlementSessionId,
) {
  if (!client) {
    throw new Error(
      "WORKBENCH_SUPABASE_CLIENT_REQUIRED",
    );
  }

  if (!actor) {
    throw new Error(
      "WORKBENCH_ACTOR_REQUIRED",
    );
  }

  if (!settlementSessionId) {
    return [];
  }

  if (actor.is_admin) {
    const {
      data,
      error,
    } = await client
      .from(
        "settlement_line_group_config",
      )
      .select(
        "line_group_id",
      )
      .eq(
        "settlement_session_id",
        settlementSessionId,
      );

    if (error) {
      throw error;
    }

    return [
      ...new Set(
        (data ?? []).map(
          (row) =>
            row.line_group_id,
        ),
      ),
    ];
  }

  const {
    data: assignments,
    error: assignmentError,
  } = await client
    .from(
      "line_group_staff_assignments",
    )
    .select(
      "line_group_id",
    )
    .eq(
      "staff_id",
      actor.staff_id,
    )
    .eq(
      "enabled",
      true,
    );

  if (assignmentError) {
    throw assignmentError;
  }

  const assignedIds = [
    ...new Set(
      (assignments ?? []).map(
        (row) =>
          row.line_group_id,
      ),
    ),
  ];

  if (!assignedIds.length) {
    return [];
  }

  const {
    data: configured,
    error: configError,
  } = await client
    .from(
      "settlement_line_group_config",
    )
    .select(
      "line_group_id",
    )
    .eq(
      "settlement_session_id",
      settlementSessionId,
    )
    .in(
      "line_group_id",
      assignedIds,
    );

  if (configError) {
    throw configError;
  }

  return [
    ...new Set(
      (configured ?? []).map(
        (row) =>
          row.line_group_id,
      ),
    ),
  ];
}


export async function loadStaffWorkbenchReadModel(
  client,
  {
    settlementSessionId,
    lineGroupIds,
    summaryGroupId = null,
    limit = 100,
    offset = 0,
  },
) {
  if (!client) {
    throw new Error(
      "WORKBENCH_SUPABASE_CLIENT_REQUIRED",
    );
  }

  if (
    !settlementSessionId
    || !lineGroupIds?.length
  ) {
    return {
      summaryRows: [],
      workItems: [],
    };
  }

  const safeLimit =
    normalizeWorkbenchLimit(
      limit,
    );

  const safeOffset =
    normalizeWorkbenchOffset(
      offset,
    );

  const [
    summaryResult,
    reviewResult,
  ] = await Promise.all([
    client.rpc(
      "staff_workbench_summary",
      {
        p_settlement_session_id:
          settlementSessionId,

        p_line_group_ids:
          lineGroupIds,

        p_summary_group_id:
          summaryGroupId,
      },
    ),

    client.rpc(
      "staff_workbench_open_reviews",
      {
        p_settlement_session_id:
          settlementSessionId,

        p_line_group_ids:
          lineGroupIds,

        p_summary_group_id:
          summaryGroupId,

        p_limit:
          safeLimit,

        p_offset:
          safeOffset,
      },
    ),
  ]);

  if (summaryResult.error) {
    throw summaryResult.error;
  }

  if (reviewResult.error) {
    throw reviewResult.error;
  }

  return {
    summaryRows:
      summaryResult.data ?? [],

    workItems:
      reviewResult.data ?? [],
  };
}


export function buildStaffWorkbenchPayload({
  actor,
  session,
  summaryRows = [],
  workItems = [],
  limit = 100,
  offset = 0,
}) {
  const safeLimit =
    normalizeWorkbenchLimit(
      limit,
    );

  const safeOffset =
    normalizeWorkbenchOffset(
      offset,
    );

  const summaryMap =
    new Map();

  let overallOrderTotal = 0;
  let overallOpenReviewCount = 0;

  for (
    const row
    of summaryRows
  ) {
    const orderTotal =
      numeric(
        row.order_total,
      );

    const openReviewCount =
      numeric(
        row.open_review_count,
      );

    overallOrderTotal +=
      orderTotal;

    overallOpenReviewCount +=
      openReviewCount;

    if (
      !summaryMap.has(
        row.summary_group_id,
      )
    ) {
      summaryMap.set(
        row.summary_group_id,
        {
          summary_group_id:
            row.summary_group_id,

          summary_group_name:
            row.summary_group_name
            ?? row.summary_group_id,

          order_total: 0,
          open_review_count: 0,

          line_groups: [],
        },
      );
    }

    const summary =
      summaryMap.get(
        row.summary_group_id,
      );

    summary.order_total +=
      orderTotal;

    summary.open_review_count +=
      openReviewCount;

    summary.line_groups.push({
      line_group_id:
        row.line_group_id,

      line_group_name:
        row.line_group_name
        ?? row.line_group_id,

      summary_group_round_id:
        row.summary_group_round_id
        ?? null,

      round_no:
        row.round_no
        ?? null,

      round_status:
        row.round_status
        ?? "NOT_STARTED",

      order_total:
        orderTotal,

      open_review_count:
        openReviewCount,
    });
  }

  const safeWorkItems =
    workItems.map(
      (row) => ({
        review_id:
          row.review_id,

        message_record_id:
          row.message_record_id,

        summary_group_id:
          row.summary_group_id,

        summary_group_name:
          row.summary_group_name
          ?? row.summary_group_id,

        line_group_id:
          row.line_group_id,

        line_group_name:
          row.line_group_name
          ?? row.line_group_id,

        summary_group_round_id:
          row.summary_group_round_id,

        round_no:
          row.round_no,

        round_status:
          row.round_status,

        event_timestamp:
          row.event_timestamp,

        message_created_at:
          row.message_created_at,

        review_created_at:
          row.review_created_at,

        user_id:
          row.user_id,

        message_type:
          row.message_type,

        text:
          row.display_text
          ?? "",

        parse_status:
          row.parse_status,

        parser_version:
          row.parser_version,

        reason_codes:
          row.reason_codes
          ?? [],

        warnings:
          row.warnings
          ?? [],

        has_image_evidence:
          row.has_image_evidence
          === true,

        message_order_total:
          numeric(
            row.message_order_total,
          ),

        items:
          Array.isArray(
            row.items,
          )
            ? row.items
            : [],
      }),
    );

  const returned =
    safeWorkItems.length;

  const nextOffset =
    safeOffset
    + returned;

  return {
    actor: {
      staff_id:
        actor?.staff_id
        ?? null,

      staff_code:
        actor?.staff_code
        ?? null,

      display_name:
        actor?.display_name
        ?? null,

      role:
        actor?.role
        ?? null,

      is_admin:
        actor?.is_admin
        === true,
    },

    settlement_session:
      session ?? null,

    overall: {
      order_total:
        overallOrderTotal,

      open_review_count:
        overallOpenReviewCount,

      line_group_count:
        summaryRows.length,
    },

    summary_groups: [
      ...summaryMap.values(),
    ],

    work_items:
      safeWorkItems,

    pagination: {
      limit:
        safeLimit,

      offset:
        safeOffset,

      returned,

      has_more:
        nextOffset
        < overallOpenReviewCount,

      next_offset:
        nextOffset,
    },
  };
}
