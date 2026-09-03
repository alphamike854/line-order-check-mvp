const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


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


export function normalizePostCloseClaimAction(
  value,
) {
  const action =
    String(
      value ?? "",
    )
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


export function normalizePostCloseClaimLeaseSeconds(
  value,
) {
  if (
    value === null
    || value === undefined
    || value === ""
  ) {
    return 300;
  }

  const parsed =
    Number(value);

  if (
    !Number.isFinite(parsed)
  ) {
    return 300;
  }

  const seconds =
    Math.trunc(parsed);

  return Math.max(
    60,
    Math.min(
      seconds,
      1800,
    ),
  );
}


export function normalizePostCloseLeaseVersion(
  value,
) {
  if (
    value === null
    || value === undefined
    || value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(parsed)
    || parsed <= 0
  ) {
    return null;
  }

  return parsed;
}


export function normalizePostCloseArchiveId(
  value,
) {
  const archiveId =
    String(
      value ?? "",
    ).trim();

  if (
    !archiveId
    || !UUID_PATTERN.test(
      archiveId,
    )
  ) {
    return null;
  }

  return archiveId;
}


export async function claimStaffPostCloseReviewWork(
  client,
  {
    archiveId,
    staffId,
    allowedLineGroupIds,
    leaseSeconds = 300,
  } = {},
) {
  if (!client) {
    throw new Error(
      "POST_CLOSE_CLAIM_SUPABASE_CLIENT_REQUIRED",
    );
  }

  const safeArchiveId =
    normalizePostCloseArchiveId(
      archiveId,
    );

  if (!safeArchiveId) {
    throw new Error(
      "ARCHIVE_ID_REQUIRED",
    );
  }

  const safeStaffId =
    String(
      staffId ?? "",
    ).trim();

  if (!safeStaffId) {
    throw new Error(
      "STAFF_ID_REQUIRED",
    );
  }

  const {
    data,
    error,
  } =
    await client.rpc(
      "claim_staff_post_close_review_work",
      {
        p_archive_id:
          safeArchiveId,

        p_staff_id:
          safeStaffId,

        p_allowed_line_group_ids:
          uniqueTextValues(
            allowedLineGroupIds,
          ),

        p_lease_seconds:
          normalizePostCloseClaimLeaseSeconds(
            leaseSeconds,
          ),
      },
    );

  if (error) {
    throw new Error(
      error.message
      ?? String(error),
    );
  }

  return data;
}


export async function releaseStaffPostCloseReviewWork(
  client,
  {
    archiveId,
    staffId,
    allowedLineGroupIds,
    expectedLeaseVersion = null,
  } = {},
) {
  if (!client) {
    throw new Error(
      "POST_CLOSE_CLAIM_SUPABASE_CLIENT_REQUIRED",
    );
  }

  const safeArchiveId =
    normalizePostCloseArchiveId(
      archiveId,
    );

  if (!safeArchiveId) {
    throw new Error(
      "ARCHIVE_ID_REQUIRED",
    );
  }

  const safeStaffId =
    String(
      staffId ?? "",
    ).trim();

  if (!safeStaffId) {
    throw new Error(
      "STAFF_ID_REQUIRED",
    );
  }

  const {
    data,
    error,
  } =
    await client.rpc(
      "release_staff_post_close_review_work",
      {
        p_archive_id:
          safeArchiveId,

        p_staff_id:
          safeStaffId,

        p_allowed_line_group_ids:
          uniqueTextValues(
            allowedLineGroupIds,
          ),

        p_expected_lease_version:
          normalizePostCloseLeaseVersion(
            expectedLeaseVersion,
          ),
      },
    );

  if (error) {
    throw new Error(
      error.message
      ?? String(error),
    );
  }

  return data;
}
