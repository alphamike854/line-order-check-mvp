import {
  parseOrder,
} from "../../src/lib/order-parser.mjs";

import {
  createReviewPreviewToken,
  reviewPreviewFingerprint,
} from "../../src/lib/review-safety.mjs";

import {
  fetchOpenReviewById,
  fetchOpenSettlementSession,
  json,
  loadParserConfig,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
} from "../../src/lib/staff-access.mjs";

import {
  loadActorSessionLineGroupIds,
} from "../../src/lib/staff-workbench.mjs";

import {
  loadStaffReviewPreviewAccess,
} from "../../src/lib/staff-review-access.mjs";


function errorStatus(message) {
  if (
    message === "REVIEW_NOT_FOUND"
  ) {
    return 404;
  }

  if (
    message === "STAFF_IDENTITY_REQUIRED"
  ) {
    return 403;
  }

  if (
    message
    === "REVIEW_PREVIEW_SIGNING_KEY_NOT_CONFIGURED"
  ) {
    return 503;
  }

  if (
    [
      "REVIEW_NOT_OPEN",
      "MESSAGE_ALREADY_UNSENT",
      "MESSAGE_GROUP_NOT_CONFIGURED",
      "SETTLEMENT_NOT_OPEN",
      "MESSAGE_OUTSIDE_CURRENT_SETTLEMENT",
      "MESSAGE_ROUND_NOT_CURRENT",
      "MESSAGE_LINE_GROUP_CONFIG_MISMATCH",
      "MESSAGE_OUTSIDE_STAFF_SCOPE",
      "CLAIM_REQUIRED",
      "CLAIM_OWNED_BY_OTHER",
    ].includes(
      message,
    )
  ) {
    return 409;
  }

  return 500;
}


export default async (req) => {
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
    // Preserve the legacy Dashboard path exactly.
    //
    // Staff Browser mode will send x-staff-key only.
    const suppliedStaffKey =
      String(
        req.headers.get(
          "x-staff-key",
        )
        ?? "",
      ).trim();

    let staffContext =
      null;

    if (suppliedStaffKey) {
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

      const session =
        await fetchOpenSettlementSession();

      if (!session) {
        return json(
          {
            ok: false,
            error:
              "SETTLEMENT_NOT_OPEN",
          },
          409,
        );
      }

      const lineGroupIds =
        await loadActorSessionLineGroupIds(
          supabase,
          auth.actor,
          session.id,
        );

      staffContext = {
        actor:
          auth.actor,
        session,
        lineGroupIds,
      };
    } else {
      const denied =
        requireDashboardAccess(
          req,
        );

      if (denied) {
        return denied;
      }
    }

    const body =
      await req.json();

    const reviewId =
      Number(
        body.review_id,
      );

    const correctedText =
      String(
        body.corrected_text
        ?? "",
      );

    if (
      !Number.isInteger(
        reviewId,
      )
      || reviewId <= 0
    ) {
      return json(
        {
          ok: false,
          error:
            "INVALID_REVIEW_ID",
        },
        400,
      );
    }

    if (
      !correctedText.trim()
    ) {
      return json(
        {
          ok: false,
          error:
            "CORRECTED_TEXT_REQUIRED",
        },
        400,
      );
    }

    let message;

    if (staffContext) {
      const access =
        await loadStaffReviewPreviewAccess(
          supabase,
          {
            reviewId,

            staffId:
              staffContext
                .actor
                .staff_id,

            settlementSessionId:
              staffContext
                .session
                .id,

            allowedLineGroupIds:
              staffContext
                .lineGroupIds,
          },
        );

      message =
        access.message;
    } else {
      ({
        message,
      } =
        await fetchOpenReviewById(
          reviewId,
        ));

      if (message.unsent) {
        return json(
          {
            ok: false,
            error:
              "MESSAGE_ALREADY_UNSENT",
          },
          409,
        );
      }
    }

    const config =
      await loadParserConfig();

    const summaryGroupId =
      message.summary_group_id;

    if (!summaryGroupId) {
      return json(
        {
          ok: false,
          error:
            "MESSAGE_GROUP_NOT_CONFIGURED",
        },
        409,
      );
    }

    const result =
      parseOrder(
        correctedText,
        config,
      );

    const canApply =
      result.status
        === "PARSED"
      && result.items.length
        > 0;

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
        reviewPreviewFingerprint({
          reviewId,

          messageRecordId:
            message.id,

          correctedText,

          normalizedText:
            result.normalized_text,

          parserVersion:
            result.parser_version,

          items:
            result.items,

          parserConfig:
            config,

          summaryGroupId,
        });

      const signed =
        createReviewPreviewToken({
          reviewId,

          messageRecordId:
            message.id,

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

      review_id:
        reviewId,

      preview_token:
        previewToken,

      preview_fingerprint:
        previewFingerprint,

      preview_issued_at:
        previewIssuedAt,

      preview_expires_at:
        previewExpiresAt,

      preview: {
        status:
          result.status,

        items:
          result.items,

        warnings:
          result.warnings,

        errors:
          result.errors,

        checksums:
          result.checksums,

        parser_version:
          result.parser_version,

        normalized_text:
          result.normalized_text,

        summary_group_id:
          summaryGroupId,

        can_apply:
          canApply,
      },
    });
  } catch (error) {
    const message =
      error?.message
      ?? String(error);

    console.error(
      "review-preview failed",
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
};


export const config = {
  path:
    "/api/review-preview",
};
