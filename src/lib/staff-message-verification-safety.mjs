import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import {
  parserConfigFingerprint,
} from "./review-safety.mjs";

import {
  normalizeLeaseVersion,
  normalizeMessageRecordId,
} from "./staff-work-claim.mjs";

import {
  normalizeVerificationNormalizedText,
  normalizeVerificationOrderItems,
  normalizeVerificationParserVersion,
} from "./staff-message-verification.mjs";


export const VERIFICATION_CORRECTION_PREVIEW_TOKEN_VERSION =
  "verification-correction-v1";

export const VERIFICATION_CORRECTION_PREVIEW_TTL_SECONDS =
  15 * 60;


function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (
    value
    && typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          stableValue(value[key]),
        ]),
    );
  }

  return value;
}


function stableJson(value) {
  return JSON.stringify(
    stableValue(value),
  );
}


function sha256(value) {
  return createHash("sha256")
    .update(
      String(value),
      "utf8",
    )
    .digest("hex");
}


function safeEqualHex(
  left,
  right,
) {
  if (
    typeof left !== "string"
    || typeof right !== "string"
    || !/^[0-9a-f]+$/iu.test(left)
    || !/^[0-9a-f]+$/iu.test(right)
  ) {
    return false;
  }

  const a =
    Buffer.from(
      left,
      "hex",
    );

  const b =
    Buffer.from(
      right,
      "hex",
    );

  return (
    a.length > 0
    && a.length === b.length
    && timingSafeEqual(
      a,
      b,
    )
  );
}


function signingKey(
  explicitKey,
) {
  if (explicitKey !== undefined) {
    const value =
      String(
        explicitKey
        ?? "",
      ).trim();

    if (!value) {
      throw new Error(
        "VERIFICATION_CORRECTION_PREVIEW_SIGNING_KEY_NOT_CONFIGURED",
      );
    }

    return value;
  }

  const value =
    String(
      process.env
        .VERIFICATION_CORRECTION_PREVIEW_SIGNING_KEY
      ?? process.env
        .REVIEW_PREVIEW_SIGNING_KEY
      ?? process.env
        .DASHBOARD_ACCESS_KEY
      ?? "",
    ).trim();

  if (!value) {
    throw new Error(
      "VERIFICATION_CORRECTION_PREVIEW_SIGNING_KEY_NOT_CONFIGURED",
    );
  }

  return value;
}


function encodeBase64urlJson(
  value,
) {
  return Buffer
    .from(
      JSON.stringify(value),
      "utf8",
    )
    .toString("base64url");
}


function decodeBase64urlJson(
  value,
) {
  return JSON.parse(
    Buffer
      .from(
        value,
        "base64url",
      )
      .toString("utf8"),
  );
}


function requiredText(
  value,
  errorCode,
) {
  if (
    typeof value !== "string"
    || !value.trim()
  ) {
    throw new Error(
      errorCode,
    );
  }

  return value;
}


export function verificationCorrectionPreviewFingerprint({
  messageRecordId,
  staffId,
  settlementSessionId,
  leaseVersion,

  sourceParserVersion,
  sourceNormalizedText,
  sourceOrderItems,

  correctedText,
  correctedParserVersion,
  correctedNormalizedText,
  correctedOrderItems,
  correctedFirstOrderCode,

  parserConfig = {},
}) {
  const safeMessageRecordId =
    normalizeMessageRecordId(
      messageRecordId,
    );

  if (!safeMessageRecordId) {
    throw new Error(
      "MESSAGE_RECORD_ID_REQUIRED",
    );
  }

  const safeStaffId =
    requiredText(
      staffId,
      "STAFF_ID_REQUIRED",
    );

  const safeSettlementSessionId =
    requiredText(
      settlementSessionId,
      "SETTLEMENT_SESSION_ID_REQUIRED",
    );

  const safeLeaseVersion =
    normalizeLeaseVersion(
      leaseVersion,
    );

  if (!safeLeaseVersion) {
    throw new Error(
      "LEASE_VERSION_REQUIRED",
    );
  }

  const safeSourceParserVersion =
    normalizeVerificationParserVersion(
      sourceParserVersion,
    );

  if (!safeSourceParserVersion) {
    throw new Error(
      "SOURCE_PARSER_VERSION_REQUIRED",
    );
  }

  const safeSourceNormalizedText =
    normalizeVerificationNormalizedText(
      sourceNormalizedText,
    );

  if (
    safeSourceNormalizedText
    === null
  ) {
    throw new Error(
      "SOURCE_NORMALIZED_TEXT_REQUIRED",
    );
  }

  const safeSourceOrderItems =
    normalizeVerificationOrderItems(
      sourceOrderItems,
    );

  if (!safeSourceOrderItems) {
    throw new Error(
      "SOURCE_ORDER_ITEMS_REQUIRED",
    );
  }

  const safeCorrectedText =
    requiredText(
      correctedText,
      "CORRECTED_TEXT_REQUIRED",
    );

  const safeCorrectedParserVersion =
    normalizeVerificationParserVersion(
      correctedParserVersion,
    );

  if (!safeCorrectedParserVersion) {
    throw new Error(
      "CORRECTED_PARSER_VERSION_REQUIRED",
    );
  }

  const safeCorrectedNormalizedText =
    normalizeVerificationNormalizedText(
      correctedNormalizedText,
    );

  if (
    safeCorrectedNormalizedText
    === null
  ) {
    throw new Error(
      "CORRECTED_NORMALIZED_TEXT_REQUIRED",
    );
  }

  const safeCorrectedOrderItems =
    normalizeVerificationOrderItems(
      correctedOrderItems,
    );

  if (!safeCorrectedOrderItems) {
    throw new Error(
      "CORRECTED_ORDER_ITEMS_REQUIRED",
    );
  }

  return sha256(
    stableJson({
      namespace:
        VERIFICATION_CORRECTION_PREVIEW_TOKEN_VERSION,

      message_record_id:
        safeMessageRecordId,

      staff_id:
        safeStaffId,

      settlement_session_id:
        safeSettlementSessionId,

      lease_version:
        safeLeaseVersion,

      source_parser_version:
        safeSourceParserVersion,

      source_normalized_text:
        safeSourceNormalizedText,

      source_order_items:
        safeSourceOrderItems,

      corrected_text:
        safeCorrectedText,

      corrected_parser_version:
        safeCorrectedParserVersion,

      corrected_normalized_text:
        safeCorrectedNormalizedText,

      corrected_order_items:
        safeCorrectedOrderItems,

      corrected_first_order_code:
        String(
          correctedFirstOrderCode
          ?? "",
        ),

      parser_config_fingerprint:
        parserConfigFingerprint(
          parserConfig,
        ),
    }),
  );
}


export function createVerificationCorrectionPreviewToken({
  messageRecordId,
  staffId,
  settlementSessionId,
  leaseVersion,
  fingerprint,
  nowMs = Date.now(),
  ttlSeconds =
    VERIFICATION_CORRECTION_PREVIEW_TTL_SECONDS,
  key,
}) {
  const safeMessageRecordId =
    normalizeMessageRecordId(
      messageRecordId,
    );

  if (!safeMessageRecordId) {
    throw new Error(
      "MESSAGE_RECORD_ID_REQUIRED",
    );
  }

  const safeStaffId =
    requiredText(
      staffId,
      "STAFF_ID_REQUIRED",
    );

  const safeSettlementSessionId =
    requiredText(
      settlementSessionId,
      "SETTLEMENT_SESSION_ID_REQUIRED",
    );

  const safeLeaseVersion =
    normalizeLeaseVersion(
      leaseVersion,
    );

  if (!safeLeaseVersion) {
    throw new Error(
      "LEASE_VERSION_REQUIRED",
    );
  }

  if (
    typeof fingerprint !== "string"
    || !/^[0-9a-f]{64}$/iu.test(
      fingerprint,
    )
  ) {
    throw new Error(
      "PREVIEW_FINGERPRINT_REQUIRED",
    );
  }

  const issuedAt =
    Math.floor(
      Number(nowMs) / 1000,
    );

  const ttl =
    Math.floor(
      Number(ttlSeconds),
    );

  if (
    !Number.isSafeInteger(
      issuedAt,
    )
    || !Number.isSafeInteger(
      ttl,
    )
    || ttl <= 0
  ) {
    throw new Error(
      "PREVIEW_TIME_INVALID",
    );
  }

  const payload = {
    v:
      VERIFICATION_CORRECTION_PREVIEW_TOKEN_VERSION,

    message_record_id:
      safeMessageRecordId,

    staff_id:
      safeStaffId,

    settlement_session_id:
      safeSettlementSessionId,

    lease_version:
      safeLeaseVersion,

    fingerprint,

    iat:
      issuedAt,

    exp:
      issuedAt
      + ttl,
  };

  const encoded =
    encodeBase64urlJson(
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
      .digest("hex");

  return {
    token:
      `${VERIFICATION_CORRECTION_PREVIEW_TOKEN_VERSION}.${encoded}.${signature}`,

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


export function verifyVerificationCorrectionPreviewToken({
  token,

  messageRecordId,
  staffId,
  settlementSessionId,
  leaseVersion,

  expectedFingerprint,

  nowMs = Date.now(),
  key,
}) {
  if (!token) {
    return {
      ok: false,
      error:
        "VERIFICATION_PREVIEW_REQUIRED",
    };
  }

  const parts =
    String(token)
      .split(".");

  if (
    parts.length !== 3
    || parts[0]
      !== VERIFICATION_CORRECTION_PREVIEW_TOKEN_VERSION
  ) {
    return {
      ok: false,
      error:
        "VERIFICATION_PREVIEW_TOKEN_INVALID",
    };
  }

  const [
    ,
    encoded,
    suppliedSignature,
  ] = parts;

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
        "VERIFICATION_PREVIEW_TOKEN_INVALID",
    };
  }

  if (
    payload?.v
    !== VERIFICATION_CORRECTION_PREVIEW_TOKEN_VERSION
  ) {
    return {
      ok: false,
      error:
        "VERIFICATION_PREVIEW_TOKEN_INVALID",
    };
  }

  let expectedSignature;

  try {
    expectedSignature =
      createHmac(
        "sha256",
        signingKey(key),
      )
        .update(
          encoded,
          "utf8",
        )
        .digest("hex");
  } catch (error) {
    throw error;
  }

  if (
    !safeEqualHex(
      suppliedSignature,
      expectedSignature,
    )
  ) {
    return {
      ok: false,
      error:
        "VERIFICATION_PREVIEW_TOKEN_INVALID",
    };
  }

  const nowSeconds =
    Math.floor(
      Number(nowMs) / 1000,
    );

  if (
    !Number.isFinite(
      payload.exp,
    )
    || payload.exp < nowSeconds
  ) {
    return {
      ok: false,
      error:
        "VERIFICATION_PREVIEW_EXPIRED",
    };
  }

  const safeMessageRecordId =
    normalizeMessageRecordId(
      messageRecordId,
    );

  const safeLeaseVersion =
    normalizeLeaseVersion(
      leaseVersion,
    );

  if (
    !safeMessageRecordId
    || !safeLeaseVersion
    || String(
      payload.message_record_id,
    ) !== String(
      safeMessageRecordId,
    )
    || String(
      payload.staff_id,
    ) !== String(
      staffId
      ?? "",
    )
    || String(
      payload.settlement_session_id,
    ) !== String(
      settlementSessionId
      ?? "",
    )
    || Number(
      payload.lease_version,
    ) !== Number(
      safeLeaseVersion,
    )
    || !safeEqualHex(
      String(
        payload.fingerprint
        ?? "",
      ),
      String(
        expectedFingerprint
        ?? "",
      ),
    )
  ) {
    return {
      ok: false,
      error:
        "VERIFICATION_PREVIEW_STALE",
    };
  }

  return {
    ok: true,

    fingerprint:
      payload.fingerprint,

    issued_at:
      new Date(
        Number(payload.iat)
        * 1000,
      ).toISOString(),

    expires_at:
      new Date(
        Number(payload.exp)
        * 1000,
      ).toISOString(),
  };
}
