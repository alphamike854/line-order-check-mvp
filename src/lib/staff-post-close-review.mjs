function uniqueTextValues(values) {
  return [
    ...new Set(
      (values ?? [])
        .map(
          (value) =>
            String(
              value ?? "",
            ).trim(),
        )
        .filter(Boolean),
    ),
  ];
}


function safeLimit(value) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed)
    || parsed <= 0
  ) {
    return 50;
  }

  return Math.min(
    parsed,
    200,
  );
}


function safeOffset(value) {
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


export function buildPostCloseReviewDisplayText(
  row,
) {
  if (
    row?.message_type
    === "image"
  ) {
    return (
      row?.ocr_text
      ?? row?.normalized_text
      ?? row?.raw_text
      ?? ""
    );
  }

  return (
    row?.raw_text
    ?? row?.normalized_text
    ?? row?.ocr_text
    ?? ""
  );
}


export async function loadStaffPostCloseReviewReadModel(
  client,
  {
    lineGroupIds,
    summaryGroupId = null,
    limit = 50,
    offset = 0,
  } = {},
) {
  if (!client) {
    throw new Error(
      "POST_CLOSE_REVIEW_SUPABASE_CLIENT_REQUIRED",
    );
  }

  const safeLineGroupIds =
    uniqueTextValues(
      lineGroupIds,
    );

  const normalizedLimit =
    safeLimit(limit);

  const normalizedOffset =
    safeOffset(offset);

  if (!safeLineGroupIds.length) {
    return {
      rows: [],
      total: 0,
      limit:
        normalizedLimit,
      offset:
        normalizedOffset,
    };
  }

  let query =
    client
      .from(
        "post_close_review_archive",
      )
      .select(
        [
          "id",
          "round_id",
          "settlement_session_id",
          "summary_group_id",
          "round_no",
          "source_review_id",
          "source_message_record_id",
          "source_message_id",
          "destination",
          "business_date",
          "event_timestamp",
          "line_group_id",
          "user_id",
          "message_type",
          "raw_text",
          "normalized_text",
          "ocr_text",
          "parse_status",
          "parser_version",
          "reason_codes",
          "warnings",
          "source_review_status",
          "source_resolution_type",
          "source_review_created_at",
          "source_resolved_at",
          "source_resolved_by",
          "image_storage_path",
          "image_stored_at",
          "image_deleted_at",
          "archive_reason",
          "archived_at",
        ].join(","),
        {
          count: "exact",
        },
      )
      .in(
        "line_group_id",
        safeLineGroupIds,
      );

  const safeSummaryGroupId =
    String(
      summaryGroupId ?? "",
    ).trim();

  if (safeSummaryGroupId) {
    query =
      query.eq(
        "summary_group_id",
        safeSummaryGroupId,
      );
  }

  const {
    data,
    error,
    count,
  } =
    await query
      .order(
        "business_date",
        {
          ascending: false,
        },
      )
      .order(
        "source_review_id",
        {
          ascending: false,
        },
      )
      .order(
        "id",
        {
          ascending: false,
        },
      )
      .range(
        normalizedOffset,
        normalizedOffset
          + normalizedLimit
          - 1,
      );

  if (error) {
    throw error;
  }

  return {
    rows:
      data ?? [],
    total:
      Number(
        count ?? 0,
      ),
    limit:
      normalizedLimit,
    offset:
      normalizedOffset,
  };
}


export function buildStaffPostCloseReviewItem(
  row,
  {
    lineGroupName = null,
  } = {},
) {
  const {
    image_storage_path:
      imageStoragePath,
  } = row ?? {};

  return {
    archive_id:
      row?.id
      ?? null,

    source_review_id:
      row?.source_review_id
      ?? null,

    source_message_record_id:
      row?.source_message_record_id
      ?? null,

    source_message_id:
      row?.source_message_id
      ?? null,

    round_id:
      row?.round_id
      ?? null,

    settlement_session_id:
      row?.settlement_session_id
      ?? null,

    summary_group_id:
      row?.summary_group_id
      ?? null,

    round_no:
      row?.round_no
      ?? null,

    business_date:
      row?.business_date
      ?? null,

    event_timestamp:
      row?.event_timestamp
      ?? null,

    line_group_id:
      row?.line_group_id
      ?? null,

    line_group_name:
      lineGroupName
      ?? row?.line_group_id
      ?? null,

    user_id:
      row?.user_id
      ?? null,

    message_type:
      row?.message_type
      ?? null,

    text:
      buildPostCloseReviewDisplayText(
        row,
      ),

    parse_status:
      row?.parse_status
      ?? null,

    parser_version:
      row?.parser_version
      ?? null,

    reason_codes:
      Array.isArray(
        row?.reason_codes,
      )
        ? row.reason_codes
        : [],

    warnings:
      Array.isArray(
        row?.warnings,
      )
        ? row.warnings
        : [],

    source_review_status:
      row?.source_review_status
      ?? null,

    source_resolution_type:
      row?.source_resolution_type
      ?? null,

    source_review_created_at:
      row?.source_review_created_at
      ?? null,

    source_resolved_at:
      row?.source_resolved_at
      ?? null,

    source_resolved_by:
      row?.source_resolved_by
      ?? null,

    archive_reason:
      row?.archive_reason
      ?? null,

    archived_at:
      row?.archived_at
      ?? null,

    has_image_evidence:
      Boolean(
        row?.message_type
          === "image"
        && imageStoragePath
        && !row?.image_deleted_at
      ),
  };
}
