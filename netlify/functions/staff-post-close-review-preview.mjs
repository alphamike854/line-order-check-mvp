import {
  parseOrder,
} from "../../src/lib/order-parser.mjs";

import {
  json,
  loadParserConfig,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
  loadWorkbenchActorLineGroups,
} from "../../src/lib/staff-access.mjs";

import {
  normalizePostCloseArchiveId,
  normalizePostCloseLeaseVersion,
} from "../../src/lib/staff-post-close-review-claim.mjs";

import {
  createPostCloseReviewPreviewToken,
  loadStaffPostCloseReviewResolutionAccess,
  postCloseReviewPreviewFingerprint,
} from "../../src/lib/staff-post-close-review-resolution.mjs";


const CLAIM_CONFLICT_CODES =
  new Set([
    "CLAIM_REQUIRED",
    "CLAIM_EXPIRED",
    "CLAIM_OWNED_BY_OTHER",
    "STALE_CLAIM_VERSION",
  ]);


function errorStatus(
  message,
) {
  if (
    message
    === "POST_CLOSE_REVIEW_NOT_FOUND"
  ) {
    return 404;
  }

  if (
    message
    === "STAFF_IDENTITY_REQUIRED"
  ) {
    return 403;
  }

  if (
    message
    === "LEASE_VERSION_REQUIRED"
  ) {
    return 428;
  }

  if (
    message
    === "POST_CLOSE_REVIEW_PREVIEW_SIGNING_KEY_NOT_CONFIGURED"
  ) {
    return 503;
  }

  if (
    CLAIM_CONFLICT_CODES.has(
      message,
    )
  ) {
    return 409;
  }

  if (
    message
    === "POST_CLOSE_REVIEW_GROUP_NOT_CONFIGURED"
  ) {
    return 409;
  }

  return 500;
}


function uniqueLineGroupIds(
  rows,
) {
  return [
    ...new Set(
      (rows ?? [])
        .map(
          (row) =>
            String(
              row?.line_group_id
              ?? "",
            ).trim(),
        )
        .filter(Boolean),
    ),
  ];
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
          client:
            supabase,
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

    if (
      !auth.actor.staff_id
    ) {
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

    const archiveId =
      normalizePostCloseArchiveId(
        body?.archive_id,
      );

    if (!archiveId) {
      return json(
        {
          ok: false,
          error:
            "INVALID_ARCHIVE_ID",
        },
        400,
      );
    }

    const expectedLeaseVersion =
      normalizePostCloseLeaseVersion(
        body?.lease_version,
      );

    if (!expectedLeaseVersion) {
      return json(
        {
          ok: false,
          error:
            "LEASE_VERSION_REQUIRED",
          claim_conflict:
            true,
        },
        428,
      );
    }

    const correctedText =
      String(
        body?.corrected_text
        ?? "",
      );

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

    // Current enabled Staff <-> LINE Group assignments are
    // authoritative for post-close authorization.
    //
    // Historical Settlement/Round ownership remains evidence
    // inside the durable archive only.
    const lineGroups =
      await loadWorkbenchActorLineGroups(
        supabase,
        auth.actor,
      );

    const allowedLineGroupIds =
      uniqueLineGroupIds(
        lineGroups,
      );

    const access =
      await loadStaffPostCloseReviewResolutionAccess(
        supabase,
        {
          archiveId,

          staffId:
            auth.actor.staff_id,

          lineGroupIds:
            allowedLineGroupIds,

          expectedLeaseVersion,
        },
      );

    const summaryGroupId =
      String(
        access
          ?.archive
          ?.summary_group_id
        ?? "",
      ).trim();

    if (!summaryGroupId) {
      return json(
        {
          ok: false,
          error:
            "POST_CLOSE_REVIEW_GROUP_NOT_CONFIGURED",
        },
        409,
      );
    }

    const config =
      await loadParserConfig();

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
        postCloseReviewPreviewFingerprint({
          archiveId,

          staffId:
            auth.actor.staff_id,

          leaseVersion:
            expectedLeaseVersion,

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
        createPostCloseReviewPreviewToken({
          archiveId,

          staffId:
            auth.actor.staff_id,

          leaseVersion:
            expectedLeaseVersion,

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

      archive_id:
        archiveId,

      lease_version:
        expectedLeaseVersion,

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
      "staff-post-close-review-preview failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          message,

        ...(
          CLAIM_CONFLICT_CODES.has(
            message,
          )
            ? {
                claim_conflict:
                  true,
              }
            : {}
        ),
      },
      errorStatus(
        message,
      ),
    );
  }
}


export const config = {
  path:
    "/api/staff-post-close-review-preview",
};
