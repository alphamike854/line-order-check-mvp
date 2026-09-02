function normalizeReviewId(value) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed)
    || parsed <= 0
  ) {
    throw new Error(
      "INVALID_REVIEW_ID",
    );
  }

  return parsed;
}


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


export async function loadStaffReviewPreviewAccess(
  client,
  {
    reviewId,
    staffId,
    settlementSessionId,
    allowedLineGroupIds,
  } = {},
) {
  if (!client) {
    throw new Error(
      "STAFF_REVIEW_SUPABASE_CLIENT_REQUIRED",
    );
  }

  const safeReviewId =
    normalizeReviewId(
      reviewId,
    );

  const safeStaffId =
    String(
      staffId ?? "",
    ).trim();

  if (!safeStaffId) {
    throw new Error(
      "STAFF_IDENTITY_REQUIRED",
    );
  }

  const safeSettlementSessionId =
    String(
      settlementSessionId ?? "",
    ).trim();

  if (!safeSettlementSessionId) {
    throw new Error(
      "SETTLEMENT_NOT_OPEN",
    );
  }

  const safeLineGroupIds =
    uniqueTextValues(
      allowedLineGroupIds,
    );

  const {
    data: review,
    error: reviewError,
  } = await client
    .from("review_items")
    .select(
      "id,message_record_id,reason_codes,warnings,status,created_at",
    )
    .eq(
      "id",
      safeReviewId,
    )
    .maybeSingle();

  if (reviewError) {
    throw reviewError;
  }

  if (!review) {
    throw new Error(
      "REVIEW_NOT_FOUND",
    );
  }

  if (
    review.status
    !== "OPEN"
  ) {
    throw new Error(
      "REVIEW_NOT_OPEN",
    );
  }

  const {
    data: message,
    error: messageError,
  } = await client
    .from("messages")
    .select(
      "id,business_date,settlement_session_id,summary_group_id,summary_group_round_id,line_group_id,user_id,message_type,raw_text,normalized_text,ocr_text,parse_status,unsent,created_at",
    )
    .eq(
      "id",
      review.message_record_id,
    )
    .maybeSingle();

  if (messageError) {
    throw messageError;
  }

  if (!message) {
    throw new Error(
      "MESSAGE_NOT_FOUND",
    );
  }

  if (message.unsent) {
    throw new Error(
      "MESSAGE_ALREADY_UNSENT",
    );
  }

  if (
    message.settlement_session_id
    !== safeSettlementSessionId
  ) {
    throw new Error(
      "MESSAGE_OUTSIDE_CURRENT_SETTLEMENT",
    );
  }

  if (
    !message.summary_group_id
    || !message.summary_group_round_id
  ) {
    throw new Error(
      "MESSAGE_ROUND_NOT_CURRENT",
    );
  }

  if (
    !safeLineGroupIds.includes(
      message.line_group_id,
    )
  ) {
    throw new Error(
      "MESSAGE_OUTSIDE_STAFF_SCOPE",
    );
  }

  const {
    data: configured,
    error: configError,
  } = await client
    .from(
      "settlement_line_group_config",
    )
    .select(
      "line_group_id,summary_group_id",
    )
    .eq(
      "settlement_session_id",
      safeSettlementSessionId,
    )
    .eq(
      "line_group_id",
      message.line_group_id,
    )
    .eq(
      "summary_group_id",
      message.summary_group_id,
    )
    .maybeSingle();

  if (configError) {
    throw configError;
  }

  if (!configured) {
    throw new Error(
      "MESSAGE_LINE_GROUP_CONFIG_MISMATCH",
    );
  }

  const {
    data: latestRounds,
    error: roundError,
  } = await client
    .from(
      "settlement_summary_group_rounds",
    )
    .select(
      "id,round_no,status",
    )
    .eq(
      "settlement_session_id",
      safeSettlementSessionId,
    )
    .eq(
      "summary_group_id",
      message.summary_group_id,
    )
    .order(
      "round_no",
      {
        ascending: false,
      },
    )
    .limit(1);

  if (roundError) {
    throw roundError;
  }

  const latestRound =
    latestRounds?.[0]
    ?? null;

  if (
    !latestRound
    || latestRound.id
      !== message.summary_group_round_id
  ) {
    throw new Error(
      "MESSAGE_ROUND_NOT_CURRENT",
    );
  }

  const {
    data: claimRows,
    error: claimError,
  } = await client.rpc(
    "staff_workbench_claim_state",
    {
      p_message_record_ids: [
        message.id,
      ],
    },
  );

  if (claimError) {
    throw claimError;
  }

  const claim =
    claimRows?.[0]
    ?? null;

  // Expired leases are intentionally absent from
  // staff_workbench_claim_state and are reclaimable.
  if (!claim) {
    throw new Error(
      "CLAIM_REQUIRED",
    );
  }

  if (
    claim.staff_id
    !== safeStaffId
  ) {
    throw new Error(
      "CLAIM_OWNED_BY_OTHER",
    );
  }

  return {
    review,
    message,
    latest_round:
      latestRound,
    claim,
  };
}
