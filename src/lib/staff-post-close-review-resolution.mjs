import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import {
  parserConfigFingerprint,
} from "./review-safety.mjs";

import {
  normalizePostCloseArchiveId,
  normalizePostCloseLeaseVersion,
} from "./staff-post-close-review-claim.mjs";

import {
  loadStaffPostCloseReviewClaimState,
  resolveStaffPostCloseReviewClaimState,
} from "./staff-post-close-review.mjs";


export const POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION =
  "post-close-v1";

export const POST_CLOSE_REVIEW_PREVIEW_TTL_SECONDS =
  15 * 60;


function stableValue(
  value,
) {
  if (Array.isArray(value)) {
    return value.map(
      stableValue,
    );
  }

  if (
    value
    && typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(
          (key) => [
            key,
            stableValue(
              value[key],
            ),
          ],
        ),
    );
  }

  return value;
}


function stableStringify(
  value,
) {
  return JSON.stringify(
    stableValue(value),
  );
}


function sha256(
  value,
) {
  return createHash(
    "sha256",
  )
    .update(
      String(
        value ?? "",
      ),
      "utf8",
    )
    .digest(
      "hex",
    );
}


function base64urlJson(
  value,
) {
  return Buffer
    .from(
      JSON.stringify(value),
      "utf8",
    )
    .toString(
      "base64url",
    );
}


function decodeBase64urlJson(
  value,
) {
  return JSON.parse(
    Buffer
      .from(
        String(value),
        "base64url",
      )
      .toString(
        "utf8",
      ),
  );
}


function safeEqualHex(
  left,
  right,
) {
  const a =
    Buffer.from(
      String(
        left ?? "",
      ),
      "utf8",
    );

  const b =
    Buffer.from(
      String(
        right ?? "",
      ),
      "utf8",
    );

  return (
    a.length === b.length
    && a.length > 0
    && timingSafeEqual(
      a,
      b,
    )
  );
}


function signingKey(
  explicitKey,
) {
  const key =
    explicitKey
    || process.env
      .POST_CLOSE_REVIEW_PREVIEW_SIGNING_KEY
    || process.env
      .REVIEW_PREVIEW_SIGNING_KEY
    || process.env
      .DASHBOARD_ACCESS_KEY;

  if (!key) {
    throw new Error(
      "POST_CLOSE_REVIEW_PREVIEW_SIGNING_KEY_NOT_CONFIGURED",
    );
  }

  return key;
}


function uniqueTextValues(
  values,
) {
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


function normalizedPreviewItems(
  items,
) {
  return (
    Array.isArray(items)
      ? items
      : []
  ).map(
    (item) => ({
      category:
        String(
          item?.category
          ?? "",
        ),

      code:
        String(
          item?.code
          ?? "",
        ),

      quantity:
        Number(
          item?.quantity
          ?? 0,
        ),
    }),
  );
}


export function postCloseReviewPreviewFingerprint(
  {
    archiveId,
    staffId,
    leaseVersion,
    correctedText,
    normalizedText,
    parserVersion,
    items,
    parserConfig,
    summaryGroupId,
  } = {},
) {
  return sha256(
    stableStringify({
      archive_id:
        String(
          archiveId
          ?? "",
        ),

      staff_id:
        String(
          staffId
          ?? "",
        ),

      lease_version:
        Number(
          leaseVersion
          ?? 0,
        ),

      corrected_text_hash:
        sha256(
          correctedText,
        ),

      normalized_text:
        String(
          normalizedText
          ?? "",
        ),

      parser_version:
        String(
          parserVersion
          ?? "",
        ),

      items:
        normalizedPreviewItems(
          items,
        ),

      parser_config_fingerprint:
        parserConfigFingerprint(
          parserConfig
          ?? {},
        ),

      summary_group_id:
        String(
          summaryGroupId
          ?? "",
        ),
    }),
  );
}


export function createPostCloseReviewPreviewToken(
  {
    archiveId,
    staffId,
    leaseVersion,
    fingerprint,
    nowMs = Date.now(),
    ttlSeconds =
      POST_CLOSE_REVIEW_PREVIEW_TTL_SECONDS,
    key,
  } = {},
) {
  const safeLeaseVersion =
    normalizePostCloseLeaseVersion(
      leaseVersion,
    );

  if (!safeLeaseVersion) {
    throw new Error(
      "LEASE_VERSION_REQUIRED",
    );
  }

  const issuedAt =
    Math.floor(
      nowMs / 1000,
    );

  const payload = {
    v:
      POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION,

    archive_id:
      String(
        archiveId
        ?? "",
      ),

    staff_id:
      String(
        staffId
        ?? "",
      ),

    lease_version:
      safeLeaseVersion,

    fingerprint:
      String(
        fingerprint
        ?? "",
      ),

    iat:
      issuedAt,

    exp:
      issuedAt
      + Number(
        ttlSeconds,
      ),
  };

  const encoded =
    base64urlJson(
      payload,
    );

  const signature =
    createHmac(
      "sha256",
      signingKey(key),
    )
      .update(
        encoded,
        "utf8",
      )
      .digest(
        "hex",
      );

  return {
    token:
      `${POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION}.${encoded}.${signature}`,

    fingerprint:
      payload.fingerprint,

    issued_at:
      new Date(
        payload.iat * 1000,
      ).toISOString(),

    expires_at:
      new Date(
        payload.exp * 1000,
      ).toISOString(),
  };
}


export function verifyPostCloseReviewPreviewToken(
  {
    token,
    archiveId,
    staffId,
    leaseVersion,
    expectedFingerprint,
    nowMs = Date.now(),
    key,
  } = {},
) {
  if (!token) {
    return {
      ok: false,
      error:
        "PREVIEW_REQUIRED",
    };
  }

  const parts =
    String(token)
      .split(".");

  if (
    parts.length !== 3
    || parts[0]
      !== POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION
  ) {
    return {
      ok: false,
      error:
        "PREVIEW_TOKEN_INVALID",
    };
  }

  const [
    ,
    encoded,
    suppliedSignature,
  ] =
    parts;

  let payload;

  try {
    payload =
      decodeBase64urlJson(
        encoded,
      );
  } catch {
    return {
      ok: false,
      error:
        "PREVIEW_TOKEN_INVALID",
    };
  }

  const expectedSignature =
    createHmac(
      "sha256",
      signingKey(key),
    )
      .update(
        encoded,
        "utf8",
      )
      .digest(
        "hex",
      );

  if (
    !safeEqualHex(
      suppliedSignature,
      expectedSignature,
    )
  ) {
    return {
      ok: false,
      error:
        "PREVIEW_TOKEN_INVALID",
    };
  }

  if (
    payload?.v
    !== POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION
  ) {
    return {
      ok: false,
      error:
        "PREVIEW_TOKEN_INVALID",
    };
  }

  const nowSeconds =
    Math.floor(
      nowMs / 1000,
    );

  if (
    !Number.isFinite(
      payload?.exp,
    )
    || payload.exp
      < nowSeconds
  ) {
    return {
      ok: false,
      error:
        "PREVIEW_EXPIRED",
    };
  }

  const safeLeaseVersion =
    normalizePostCloseLeaseVersion(
      leaseVersion,
    );

  if (
    String(
      payload?.archive_id
      ?? "",
    )
      !== String(
        archiveId
        ?? "",
      )

    || String(
      payload?.staff_id
      ?? "",
    )
      !== String(
        staffId
        ?? "",
      )

    || Number(
      payload?.lease_version,
    )
      !== Number(
        safeLeaseVersion,
      )

    || !safeEqualHex(
      payload?.fingerprint,
      expectedFingerprint,
    )
  ) {
    return {
      ok: false,
      error:
        "PREVIEW_STALE",
    };
  }

  return {
    ok: true,

    fingerprint:
      payload.fingerprint,

    issued_at:
      new Date(
        Number(
          payload.iat,
        ) * 1000,
      ).toISOString(),

    expires_at:
      new Date(
        Number(
          payload.exp,
        ) * 1000,
      ).toISOString(),
  };
}


export async function loadStaffPostCloseReviewResolutionAccess(
  client,
  {
    archiveId,
    staffId,
    lineGroupIds,
    expectedLeaseVersion,
  } = {},
) {
  if (!client) {
    throw new Error(
      "POST_CLOSE_REVIEW_SUPABASE_CLIENT_REQUIRED",
    );
  }

  const safeArchiveId =
    normalizePostCloseArchiveId(
      archiveId,
    );

  if (!safeArchiveId) {
    throw new Error(
      "POST_CLOSE_REVIEW_NOT_FOUND",
    );
  }

  const safeStaffId =
    String(
      staffId
      ?? "",
    ).trim();

  if (!safeStaffId) {
    throw new Error(
      "STAFF_ID_REQUIRED",
    );
  }

  const safeLineGroupIds =
    uniqueTextValues(
      lineGroupIds,
    );

  if (!safeLineGroupIds.length) {
    throw new Error(
      "POST_CLOSE_REVIEW_NOT_FOUND",
    );
  }

  const safeExpectedLeaseVersion =
    normalizePostCloseLeaseVersion(
      expectedLeaseVersion,
    );

  if (!safeExpectedLeaseVersion) {
    throw new Error(
      "LEASE_VERSION_REQUIRED",
    );
  }

  const {
    data: archive,
    error: archiveError,
  } =
    await client
      .from(
        "post_close_review_archive",
      )
      .select(
        [
          "id",
          "summary_group_id",
          "line_group_id",
          "source_review_id",
          "source_message_record_id",
          "source_message_id",
          "message_type",
          "raw_text",
          "normalized_text",
          "ocr_text",
          "parse_status",
          "parser_version",
          "reason_codes",
          "warnings",
          "post_close_resolution_type",
        ].join(","),
      )
      .eq(
        "id",
        safeArchiveId,
      )
      .in(
        "line_group_id",
        safeLineGroupIds,
      )
      .is(
        "post_close_resolution_type",
        null,
      )
      .maybeSingle();

  if (archiveError) {
    throw archiveError;
  }

  if (!archive) {
    throw new Error(
      "POST_CLOSE_REVIEW_NOT_FOUND",
    );
  }

  const claims =
    await loadStaffPostCloseReviewClaimState(
      client,
      [
        safeArchiveId,
      ],
    );

  const claim =
    (claims ?? [])
      .find(
        (row) =>
          String(
            row?.archive_id
            ?? "",
          )
          === safeArchiveId,
      )
    ?? null;

  if (!claim) {
    throw new Error(
      "CLAIM_REQUIRED",
    );
  }

  const claimState =
    resolveStaffPostCloseReviewClaimState({
      claim,
      actorStaffId:
        safeStaffId,
    });

  if (
    claimState !== "MINE"
  ) {
    throw new Error(
      "CLAIM_OWNED_BY_OTHER",
    );
  }

  const currentLeaseVersion =
    normalizePostCloseLeaseVersion(
      claim?.lease_version,
    );

  if (!currentLeaseVersion) {
    throw new Error(
      "CLAIM_REQUIRED",
    );
  }

  if (
    currentLeaseVersion
    !== safeExpectedLeaseVersion
  ) {
    throw new Error(
      "STALE_CLAIM_VERSION",
    );
  }

  return {
    archive,

    claim,

    staff_id:
      safeStaffId,

    lease_version:
      currentLeaseVersion,
  };
}
