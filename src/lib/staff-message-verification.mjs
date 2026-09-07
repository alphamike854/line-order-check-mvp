import {
  normalizeClaimLeaseSeconds,
  normalizeLeaseVersion,
  normalizeMessageRecordId,
} from "./staff-work-claim.mjs";


export function normalizeVerificationParserVersion(
  value,
) {
  if (typeof value !== "string") {
    return null;
  }

  return value.length
    ? value
    : null;
}


export function normalizeVerificationNormalizedText(
  value,
) {
  return typeof value === "string"
    ? value
    : null;
}


export function normalizeVerificationOrderItems(
  value,
) {
  if (
    !Array.isArray(value)
    || !value.length
  ) {
    return null;
  }

  const items = [];

  for (const row of value) {
    if (
      !row
      || typeof row !== "object"
      || Array.isArray(row)
      || typeof row.category !== "string"
      || !row.category
      || typeof row.code !== "string"
      || !row.code
      || !Number.isSafeInteger(row.quantity)
    ) {
      return null;
    }

    items.push({
      category: row.category,
      code: row.code,
      quantity: row.quantity,
    });
  }

  return items;
}


export async function claimStaffMessageVerificationWork(
  client,
  {
    messageRecordId,
    staffId,
    allowedLineGroupIds,
    settlementSessionId,
    leaseSeconds,
  },
) {
  const {
    data,
    error,
  } = await client.rpc(
    "claim_staff_message_verification_work",
    {
      p_message_record_id:
        normalizeMessageRecordId(
          messageRecordId,
        ),

      p_staff_id:
        staffId,

      p_allowed_line_group_ids:
        allowedLineGroupIds,

      p_settlement_session_id:
        settlementSessionId,

      p_lease_seconds:
        normalizeClaimLeaseSeconds(
          leaseSeconds,
        ),
    },
  );

  if (error) {
    throw error;
  }

  return data;
}


export async function releaseStaffMessageVerificationWork(
  client,
  {
    messageRecordId,
    staffId,
    settlementSessionId,
    expectedLeaseVersion,
  },
) {
  const {
    data,
    error,
  } = await client.rpc(
    // Despite the legacy name, the authoritative
    // four-argument overload is a generic message
    // claim release boundary.
    "release_staff_review_work",
    {
      p_message_record_id:
        normalizeMessageRecordId(
          messageRecordId,
        ),

      p_staff_id:
        staffId,

      p_settlement_session_id:
        settlementSessionId,

      p_expected_lease_version:
        normalizeLeaseVersion(
          expectedLeaseVersion,
        ),
    },
  );

  if (error) {
    throw error;
  }

  return data;
}


export async function verifyStaffMessageOrder(
  client,
  {
    messageRecordId,
    staffId,
    allowedLineGroupIds,
    settlementSessionId,
    expectedLeaseVersion,
    expectedParserVersion,
    expectedNormalizedText,
    expectedOrderItems,
  },
) {
  const {
    data,
    error,
  } = await client.rpc(
    "verify_staff_message_order",
    {
      p_message_record_id:
        normalizeMessageRecordId(
          messageRecordId,
        ),

      p_staff_id:
        staffId,

      p_allowed_line_group_ids:
        allowedLineGroupIds,

      p_settlement_session_id:
        settlementSessionId,

      p_expected_lease_version:
        normalizeLeaseVersion(
          expectedLeaseVersion,
        ),

      p_expected_parser_version:
        normalizeVerificationParserVersion(
          expectedParserVersion,
        ),

      p_expected_normalized_text:
        normalizeVerificationNormalizedText(
          expectedNormalizedText,
        ),

      p_expected_order_items:
        normalizeVerificationOrderItems(
          expectedOrderItems,
        ),
    },
  );

  if (error) {
    throw error;
  }

  return data;
}


export function canonicalVerificationOrderItems(
  value,
) {
  const items =
    normalizeVerificationOrderItems(
      value,
    );

  if (!items) {
    return null;
  }

  return items
    .map((item) => ({
      category:
        item.category,
      code:
        item.code,
      quantity:
        item.quantity,
    }))
    .sort(
      (left, right) => {
        if (
          left.category
          < right.category
        ) {
          return -1;
        }

        if (
          left.category
          > right.category
        ) {
          return 1;
        }

        if (
          left.code
          < right.code
        ) {
          return -1;
        }

        if (
          left.code
          > right.code
        ) {
          return 1;
        }

        return (
          left.quantity
          - right.quantity
        );
      },
    );
}


export async function loadStaffMessageVerificationCorrectionAccess(
  client,
  {
    messageRecordId,
    staffId,
    allowedLineGroupIds,
    settlementSessionId,
    expectedLeaseVersion,
    nowMs = Date.now(),
  },
) {
  const safeMessageRecordId =
    normalizeMessageRecordId(
      messageRecordId,
    );

  if (!safeMessageRecordId) {
    throw new Error(
      "MESSAGE_RECORD_ID_REQUIRED",
    );
  }

  if (
    typeof staffId !== "string"
    || !staffId.trim()
  ) {
    throw new Error(
      "STAFF_ID_REQUIRED",
    );
  }

  if (
    typeof settlementSessionId
      !== "string"
    || !settlementSessionId.trim()
  ) {
    throw new Error(
      "SETTLEMENT_SESSION_ID_REQUIRED",
    );
  }

  const safeLeaseVersion =
    normalizeLeaseVersion(
      expectedLeaseVersion,
    );

  if (!safeLeaseVersion) {
    throw new Error(
      "LEASE_VERSION_REQUIRED",
    );
  }

  const safeAllowedLineGroupIds =
    Array.isArray(
      allowedLineGroupIds,
    )
      ? allowedLineGroupIds
        .filter(
          (value) =>
            typeof value
              === "string"
            && value.length,
        )
      : [];

  const {
    data: message,
    error: messageError,
  } = await client
    .from(
      "messages",
    )
    .select(
      [
        "id",
        "settlement_session_id",
        "summary_group_id",
        "summary_group_round_id",
        "line_group_id",
        "unsent",
        "parse_status",
        "parser_version",
        "normalized_text",
      ].join(","),
    )
    .eq(
      "id",
      safeMessageRecordId,
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

  if (
    message.settlement_session_id
      !== settlementSessionId
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

  if (message.unsent === true) {
    throw new Error(
      "MESSAGE_ALREADY_UNSENT",
    );
  }

  if (
    message.parse_status
      !== "PARSED"
  ) {
    throw new Error(
      "MESSAGE_NOT_READY_FOR_VERIFICATION",
    );
  }

  if (
    !safeAllowedLineGroupIds.includes(
      message.line_group_id,
    )
  ) {
    throw new Error(
      "MESSAGE_OUTSIDE_STAFF_SCOPE",
    );
  }

  const {
    data: mapping,
    error: mappingError,
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
    .eq(
      "line_group_id",
      message.line_group_id,
    )
    .eq(
      "summary_group_id",
      message.summary_group_id,
    )
    .maybeSingle();

  if (mappingError) {
    throw mappingError;
  }

  if (!mapping) {
    throw new Error(
      "MESSAGE_LINE_GROUP_CONFIG_MISMATCH",
    );
  }

  const {
    data: latestRound,
    error: latestRoundError,
  } = await client
    .from(
      "settlement_summary_group_rounds",
    )
    .select(
      "id,round_no,status",
    )
    .eq(
      "settlement_session_id",
      settlementSessionId,
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
    .limit(1)
    .maybeSingle();

  if (latestRoundError) {
    throw latestRoundError;
  }

  if (
    !latestRound
    || latestRound.id
      !== message.summary_group_round_id
    || ![
      "OPEN",
      "CLOSED",
    ].includes(
      latestRound.status,
    )
  ) {
    throw new Error(
      "MESSAGE_ROUND_NOT_CURRENT",
    );
  }

  const {
    data: orderItemRows,
    error: orderItemsError,
  } = await client
    .from(
      "order_items",
    )
    .select(
      "category,code,quantity",
    )
    .eq(
      "message_record_id",
      safeMessageRecordId,
    )
    .order(
      "category",
      {
        ascending: true,
      },
    )
    .order(
      "code",
      {
        ascending: true,
      },
    )
    .order(
      "quantity",
      {
        ascending: true,
      },
    );

  if (orderItemsError) {
    throw orderItemsError;
  }

  const sourceOrderItems =
    canonicalVerificationOrderItems(
      orderItemRows,
    );

  if (!sourceOrderItems) {
    throw new Error(
      "MESSAGE_HAS_NO_ORDER_ITEMS",
    );
  }

  const sourceParserVersion =
    normalizeVerificationParserVersion(
      message.parser_version,
    );

  const sourceNormalizedText =
    normalizeVerificationNormalizedText(
      message.normalized_text,
    );

  if (
    !sourceParserVersion
    || sourceNormalizedText
      === null
  ) {
    throw new Error(
      "VERIFICATION_SOURCE_CHANGED",
    );
  }

  const {
    data: verificationRows,
    error: verificationError,
  } = await client
    .from(
      "message_verifications",
    )
    .select(
      "message_record_id",
    )
    .eq(
      "message_record_id",
      safeMessageRecordId,
    )
    .limit(1);

  if (verificationError) {
    throw verificationError;
  }

  if (
    Array.isArray(
      verificationRows,
    )
    && verificationRows.length
  ) {
    throw new Error(
      "MESSAGE_ALREADY_VERIFIED",
    );
  }

  const {
    data: claimRows,
    error: claimError,
  } = await client.rpc(
    "staff_workbench_claim_state",
    {
      p_message_record_ids: [
        safeMessageRecordId,
      ],
    },
  );

  if (claimError) {
    throw claimError;
  }

  const claim =
    Array.isArray(
      claimRows,
    )
      ? claimRows.find(
        (row) =>
          row.message_record_id
            === safeMessageRecordId,
      )
      : null;

  if (!claim) {
    throw new Error(
      "CLAIM_REQUIRED",
    );
  }

  const claimExpiresAtMs =
    Date.parse(
      claim.claim_expires_at
      ?? "",
    );

  if (
    !Number.isFinite(
      claimExpiresAtMs,
    )
    || claimExpiresAtMs
      <= Number(nowMs)
  ) {
    throw new Error(
      "CLAIM_EXPIRED",
    );
  }

  if (
    claim.staff_id
      !== staffId
  ) {
    throw new Error(
      "CLAIM_OWNED_BY_OTHER",
    );
  }

  const claimLeaseVersion =
    normalizeLeaseVersion(
      claim.lease_version,
    );

  if (
    !claimLeaseVersion
    || claimLeaseVersion
      !== safeLeaseVersion
  ) {
    throw new Error(
      "STALE_CLAIM_VERSION",
    );
  }

  return {
    message_record_id:
      safeMessageRecordId,

    settlement_session_id:
      settlementSessionId,

    summary_group_id:
      message.summary_group_id,

    summary_group_round_id:
      message.summary_group_round_id,

    line_group_id:
      message.line_group_id,

    round_no:
      latestRound.round_no,

    round_status:
      latestRound.status,

    source_parser_version:
      sourceParserVersion,

    source_normalized_text:
      sourceNormalizedText,

    source_order_items:
      sourceOrderItems,

    lease_version:
      claimLeaseVersion,

    claim_expires_at:
      claim.claim_expires_at,
  };
}


export async function correctStaffMessageVerificationOrder(
  client,
  {
    messageRecordId,
    staffId,
    allowedLineGroupIds,
    settlementSessionId,
    expectedLeaseVersion,

    expectedParserVersion,
    expectedNormalizedText,
    expectedOrderItems,

    correctedText,
    correctedParserVersion,
    correctedNormalizedText,
    correctedOrderItems,
    correctedFirstOrderCode,
  },
) {
  const {
    data,
    error,
  } = await client.rpc(
    "correct_staff_message_verification_order",
    {
      p_message_record_id:
        normalizeMessageRecordId(
          messageRecordId,
        ),

      p_staff_id:
        staffId,

      p_allowed_line_group_ids:
        allowedLineGroupIds,

      p_settlement_session_id:
        settlementSessionId,

      p_expected_lease_version:
        normalizeLeaseVersion(
          expectedLeaseVersion,
        ),

      p_expected_parser_version:
        normalizeVerificationParserVersion(
          expectedParserVersion,
        ),

      p_expected_normalized_text:
        normalizeVerificationNormalizedText(
          expectedNormalizedText,
        ),

      p_expected_order_items:
        canonicalVerificationOrderItems(
          expectedOrderItems,
        ),

      p_corrected_text:
        correctedText,

      p_corrected_parser_version:
        normalizeVerificationParserVersion(
          correctedParserVersion,
        ),

      p_corrected_normalized_text:
        normalizeVerificationNormalizedText(
          correctedNormalizedText,
        ),

      p_corrected_order_items:
        canonicalVerificationOrderItems(
          correctedOrderItems,
        ),

      p_corrected_first_order_code:
        String(
          correctedFirstOrderCode
          ?? "",
        ),
    },
  );

  if (error) {
    throw error;
  }

  return data;
}
