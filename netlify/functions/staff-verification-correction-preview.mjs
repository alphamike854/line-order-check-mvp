import {
  parseOrder,
} from "../../src/lib/order-parser.mjs";

import {
  firstLedgerCode,
} from "../../src/lib/report-ledger.mjs";

import {
  fetchOpenSettlementSession,
  json,
  loadParserConfig,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
} from "../../src/lib/staff-access.mjs";

import {
  loadActorSessionLineGroupIds,
} from "../../src/lib/staff-workbench.mjs";

import {
  normalizeLeaseVersion,
  normalizeMessageRecordId,
} from "../../src/lib/staff-work-claim.mjs";

import {
  canonicalVerificationOrderItems,
  loadStaffMessageVerificationCorrectionAccess,
} from "../../src/lib/staff-message-verification.mjs";

import {
  createVerificationCorrectionPreviewToken,
  verificationCorrectionPreviewFingerprint,
} from "../../src/lib/staff-message-verification-safety.mjs";


const CORRECTION_CONFLICTS =
  new Set([
    "MESSAGE_NOT_FOUND",
    "MESSAGE_ALREADY_VERIFIED",
    "MESSAGE_ALREADY_UNSENT",
    "MESSAGE_NOT_READY_FOR_VERIFICATION",
    "MESSAGE_HAS_NO_ORDER_ITEMS",
    "MESSAGE_OUTSIDE_STAFF_SCOPE",
    "MESSAGE_OUTSIDE_CURRENT_SETTLEMENT",
    "MESSAGE_ROUND_NOT_CURRENT",
    "MESSAGE_LINE_GROUP_CONFIG_MISMATCH",
    "VERIFICATION_SOURCE_CHANGED",
    "CLAIM_REQUIRED",
    "CLAIM_EXPIRED",
    "CLAIM_OWNED_BY_OTHER",
    "STALE_CLAIM_VERSION",
    "SETTLEMENT_NOT_OPEN",
    "STAFF_NOT_ACTIVE",
  ]);


function errorStatus(
  message,
) {


  if (
    message
      === "VERIFICATION_CORRECTION_PREVIEW_SIGNING_KEY_NOT_CONFIGURED"
  ) {
    return 503;
  }

  if (
    CORRECTION_CONFLICTS.has(
      message,
    )
  ) {
    return 409;
  }

  return 500;
}


export default async function handler(
  req,
) {
  if (req.method !== "POST") {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  try {
    const auth =
      await authenticateWorkbenchActor(
        req,
        {
          client: supabase,
        },
      );

    if (!auth.ok) {
      return json(
        {
          ok: false,
          error:
            auth.error,
        },
        auth.status,
      );
    }

    if (!auth.actor.staff_id) {
      return json(
        {
          ok: false,
          error:
            "STAFF_IDENTITY_REQUIRED",
        },
        403,
      );
    }

    let body;

    try {
      body =
        await req.json();
    } catch {
      return json(
        {
          ok: false,
          error:
            "INVALID_JSON",
        },
        400,
      );
    }

    const messageRecordId =
      normalizeMessageRecordId(
        body?.message_record_id,
      );

    if (!messageRecordId) {
      return json(
        {
          ok: false,
          error:
            "MESSAGE_RECORD_ID_REQUIRED",
        },
        400,
      );
    }

    const leaseVersion =
      normalizeLeaseVersion(
        body?.lease_version,
      );

    if (!leaseVersion) {
      return json(
        {
          ok: false,
          error:
            "LEASE_VERSION_REQUIRED",
        },
        400,
      );
    }

    const correctedText =
      typeof body?.corrected_text
        === "string"
        ? body.corrected_text
        : "";

    if (!correctedText.trim()) {
      return json(
        {
          ok: false,
          error:
            "CORRECTED_TEXT_REQUIRED",
        },
        400,
      );
    }

    const session =
      await fetchOpenSettlementSession();

    if (!session) {
      return json(
        {
          ok: false,
          error:
            "NO_OPEN_SETTLEMENT",
        },
        409,
      );
    }

    const allowedLineGroupIds =
      await loadActorSessionLineGroupIds(
        supabase,
        auth.actor,
        session.id,
      );

    if (!allowedLineGroupIds.length) {
      return json(
        {
          ok: false,
          error:
            "NO_ASSIGNED_LINE_GROUPS",
        },
        403,
      );
    }

    const access =
      await loadStaffMessageVerificationCorrectionAccess(
        supabase,
        {
          messageRecordId,
          staffId:
            auth.actor.staff_id,
          allowedLineGroupIds,
          settlementSessionId:
            session.id,
          expectedLeaseVersion:
            leaseVersion,
        },
      );

    const parserConfig =
      await loadParserConfig();

    const parsed =
      parseOrder(
        correctedText,
        parserConfig,
      );

    const correctedOrderItems =
      canonicalVerificationOrderItems(
        parsed.items,
      );

    const correctedFirstOrderCode =
      Array.isArray(
        parsed.items,
      )
        ? (
          firstLedgerCode(
            parsed.items,
            correctedText,
          )
          || null
        )
        : null;

    const canApply =
      parsed.status
        === "PARSED"
      && Boolean(
        correctedOrderItems?.length,
      )
      && Boolean(
        correctedFirstOrderCode,
      )
      && typeof parsed.parser_version
        === "string"
      && parsed.parser_version.length
        > 0
      && typeof parsed.normalized_text
        === "string"
      && parsed.normalized_text.trim()
        .length > 0;

    let previewToken =
      null;

    let previewFingerprint =
      null;

    let previewIssuedAt =
      null;

    let previewExpiresAt =
      null;

    if (canApply) {
      previewFingerprint =
        verificationCorrectionPreviewFingerprint({
          messageRecordId,

          staffId:
            auth.actor.staff_id,

          settlementSessionId:
            session.id,

          leaseVersion,

          sourceParserVersion:
            access
              .source_parser_version,

          sourceNormalizedText:
            access
              .source_normalized_text,

          sourceOrderItems:
            access
              .source_order_items,

          correctedText,

          correctedParserVersion:
            parsed.parser_version,

          correctedNormalizedText:
            parsed.normalized_text,

          correctedOrderItems,

          correctedFirstOrderCode,

          parserConfig,
        });

      const signed =
        createVerificationCorrectionPreviewToken({
          messageRecordId,

          staffId:
            auth.actor.staff_id,

          settlementSessionId:
            session.id,

          leaseVersion,

          fingerprint:
            previewFingerprint,
        });

      previewToken =
        signed.token;

      previewIssuedAt =
        signed.issued_at;

      previewExpiresAt =
        signed.expires_at;
    }

    return json({
      ok: true,

      message_record_id:
        messageRecordId,

      lease_version:
        leaseVersion,

      preview_token:
        previewToken,

      preview_fingerprint:
        previewFingerprint,

      preview_issued_at:
        previewIssuedAt,

      preview_expires_at:
        previewExpiresAt,

      source: {
        parser_version:
          access
            .source_parser_version,

        normalized_text:
          access
            .source_normalized_text,

        items:
          access
            .source_order_items,
      },

      preview: {
        status:
          parsed.status,

        items:
          correctedOrderItems
          ?? [],

        warnings:
          parsed.warnings
          ?? [],

        errors:
          parsed.errors
          ?? [],

        checksums:
          parsed.checksums
          ?? null,

        parser_version:
          parsed.parser_version
          ?? null,

        normalized_text:
          parsed.normalized_text
          ?? null,

        first_order_code:
          correctedFirstOrderCode,

        summary_group_id:
          access.summary_group_id,

        summary_group_round_id:
          access
            .summary_group_round_id,

        round_status:
          access.round_status,

        canonical_mutation_if_applied:
          access.round_status
            === "OPEN",

        can_apply:
          canApply,
      },
    });
  } catch (error) {
    const message =
      error?.message
      ?? String(error);

    console.error(
      "staff-verification-correction-preview failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          message,
      },
      errorStatus(
        message,
      ),
    );
  }
}


export const config = {
  path:
    "/api/staff-verification-correction-preview",
};
