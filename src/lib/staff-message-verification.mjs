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
