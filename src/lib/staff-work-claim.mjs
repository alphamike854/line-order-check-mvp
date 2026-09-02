export function normalizeClaimLeaseSeconds(
  value,
) {
  if (
    value === null
    || value === undefined
    || String(value).trim() === ""
  ) {
    return 300;
  }

  const parsed =
    Number(value);

  if (!Number.isInteger(parsed)) {
    return 300;
  }

  return Math.max(
    60,
    Math.min(
      parsed,
      1800,
    ),
  );
}


export function normalizeLeaseVersion(
  value,
) {
  if (
    value === null
    || value === undefined
    || String(value).trim() === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed)
    || parsed <= 0
  ) {
    return null;
  }

  return parsed;
}


export function normalizeClaimAction(
  value,
) {
  const action =
    String(value ?? "")
      .trim()
      .toUpperCase();

  if (
    action === "CLAIM"
    || action === "RELEASE"
  ) {
    return action;
  }

  return null;
}


export function normalizeMessageRecordId(
  value,
) {
  const id =
    String(value ?? "")
      .trim();

  return id || null;
}


export async function claimStaffReviewWork(
  client,
  {
    messageRecordId,
    staffId,
    allowedLineGroupIds,
    leaseSeconds,
  },
) {
  const {
    data,
    error,
  } = await client.rpc(
    "claim_staff_review_work",
    {
      p_message_record_id:
        messageRecordId,

      p_staff_id:
        staffId,

      p_allowed_line_group_ids:
        allowedLineGroupIds,

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


export async function releaseStaffReviewWork(
  client,
  {
    messageRecordId,
    staffId,
    expectedLeaseVersion,
  },
) {
  const {
    data,
    error,
  } = await client.rpc(
    "release_staff_review_work",
    {
      p_message_record_id:
        messageRecordId,

      p_staff_id:
        staffId,

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
