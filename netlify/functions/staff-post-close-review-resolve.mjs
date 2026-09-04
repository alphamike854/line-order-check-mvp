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
  loadStaffPostCloseReviewResolutionAccess,
  postCloseReviewPreviewFingerprint,
  verifyPostCloseReviewPreviewToken,
} from "../../src/lib/staff-post-close-review-resolution.mjs";


const CLAIM_CONFLICT_CODES =
  new Set([
    "CLAIM_REQUIRED",
    "CLAIM_EXPIRED",
    "CLAIM_OWNED_BY_OTHER",
    "STALE_CLAIM_VERSION",
    "CLAIM_RELEASE_FAILED",
    "STAFF_NOT_ACTIVE",
  ]);


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


function previewErrorStatus(
  code,
) {
  if (
    code === "PREVIEW_REQUIRED"
  ) {
    return 428;
  }

  if (
    code === "PREVIEW_EXPIRED"
    || code === "PREVIEW_STALE"
  ) {
    return 409;
  }

  if (
    code === "PREVIEW_TOKEN_INVALID"
  ) {
    return 400;
  }

  return 409;
}


function mapRpcError(
  error,
) {
  const message =
    String(
      error?.message
      ?? error
      ?? "UNKNOWN_ERROR",
    );

  const mappings = [
    [
      "POST_CLOSE_REVIEW_NOT_FOUND",
      404,
    ],
    [
      "POST_CLOSE_REVIEW_ALREADY_RESOLVED",
      409,
    ],
    [
      "CLAIM_REQUIRED",
      409,
    ],
    [
      "CLAIM_EXPIRED",
      409,
    ],
    [
      "CLAIM_OWNED_BY_OTHER",
      409,
    ],
    [
      "STALE_CLAIM_VERSION",
      409,
    ],
    [
      "CLAIM_RELEASE_FAILED",
      409,
    ],
    [
      "LEASE_VERSION_REQUIRED",
      428,
    ],
    [
      "STAFF_ID_REQUIRED",
      403,
    ],
    [
      "STAFF_NOT_ACTIVE",
      403,
    ],
    [
      "CORRECTION_TEXT_REQUIRED",
      400,
    ],
    [
      "CORRECTION_NORMALIZED_TEXT_REQUIRED",
      400,
    ],
    [
      "CORRECTION_PARSER_VERSION_REQUIRED",
      400,
    ],
    [
      "CORRECTION_ITEMS_REQUIRED",
      400,
    ],
    [
      "PREVIEW_FINGERPRINT_REQUIRED",
      400,
    ],
    [
      "PREVIEW_TIMESTAMP_REQUIRED",
      400,
    ],
  ];

  for (
    const [
      code,
      status,
    ]
    of mappings
  ) {
    if (
      message.includes(
        code,
      )
    ) {
      return [
        status,
        code,
      ];
    }
  }

  return [
    500,
    message,
  ];
}


function rpcErrorResponse(
  error,
) {
  const [
    status,
    code,
  ] =
    mapRpcError(
      error,
    );

  return json(
    {
      ok: false,
      error:
        code,

      ...(
        CLAIM_CONFLICT_CODES.has(
          code,
        )
          ? {
              claim_conflict:
                true,
            }
          : {}
      ),
    },
    status,
  );
}


function accessErrorStatus(
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
    || message === "STAFF_ID_REQUIRED"
    || message === "STAFF_NOT_ACTIVE"
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

    const action =
      String(
        body?.action
        ?? "",
      )
        .trim()
        .toUpperCase();

    if (
      action !== "CORRECT"
      && action !== "IGNORE"
    ) {
      return json(
        {
          ok: false,
          error:
            "INVALID_POST_CLOSE_REVIEW_ACTION",
        },
        400,
      );
    }

    // Resolve current Staff authorization server-side.
    const lineGroups =
      await loadWorkbenchActorLineGroups(
        supabase,
        auth.actor,
      );

    const allowedLineGroupIds =
      uniqueLineGroupIds(
        lineGroups,
      );

    // Read-time ownership/scope check.
    //
    // D1A RPC repeats the critical ownership checks atomically
    // under the post-close advisory lock before mutation.
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


    // ==========================================================
    // IGNORE
    // ==========================================================

    if (
      action === "IGNORE"
    ) {
      const {
        data,
        error,
      } =
        await supabase.rpc(
          "resolve_staff_post_close_review",
          {
            p_archive_id:
              archiveId,

            p_staff_id:
              auth.actor.staff_id,

            p_allowed_line_group_ids:
              allowedLineGroupIds,

            p_expected_lease_version:
              expectedLeaseVersion,

            p_action:
              "IGNORE",

            p_corrected_text:
              null,

            p_normalized_text:
              null,

            p_parser_version:
              null,

            p_items:
              null,

            p_preview_fingerprint:
              null,

            p_previewed_at:
              null,
          },
        );

      if (error) {
        return rpcErrorResponse(
          error,
        );
      }

      return json({
        ok: true,

        archive_id:
          archiveId,

        resolution:
          data,
      });
    }


    // ==========================================================
    // CORRECT
    // ==========================================================

    if (
      action === "CORRECT"
    ) {
      const correctedText =
        String(
          body?.corrected_text
          ?? "",
        );

      const previewToken =
        String(
          body?.preview_token
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

      if (!previewToken) {
        return json(
          {
            ok: false,
            error:
              "PREVIEW_REQUIRED",
            requires_preview:
              true,
          },
          428,
        );
      }

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

      // Reparse at mutation time.
      //
      // Browser parser results are never trusted.
      const config =
        await loadParserConfig();

      const result =
        parseOrder(
          correctedText,
          config,
        );

      if (
        result.status
          !== "PARSED"
        || !result.items.length
      ) {
        return json(
          {
            ok: false,
            error:
              "CORRECTION_NOT_PARSEABLE",

            preview: {
              status:
                result.status,

              items:
                result.items,

              warnings:
                result.warnings,

              errors:
                result.errors,
            },
          },
          409,
        );
      }

      const fingerprint =
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

      const verified =
        verifyPostCloseReviewPreviewToken({
          token:
            previewToken,

          archiveId,

          staffId:
            auth.actor.staff_id,

          leaseVersion:
            expectedLeaseVersion,

          expectedFingerprint:
            fingerprint,
        });

      if (!verified.ok) {
        return json(
          {
            ok: false,

            error:
              verified.error,

            requires_preview:
              true,
          },
          previewErrorStatus(
            verified.error,
          ),
        );
      }

      const {
        data,
        error,
      } =
        await supabase.rpc(
          "resolve_staff_post_close_review",
          {
            p_archive_id:
              archiveId,

            p_staff_id:
              auth.actor.staff_id,

            p_allowed_line_group_ids:
              allowedLineGroupIds,

            p_expected_lease_version:
              expectedLeaseVersion,

            p_action:
              "CORRECT",

            p_corrected_text:
              correctedText,

            p_normalized_text:
              result.normalized_text,

            p_parser_version:
              result.parser_version,

            p_items:
              result.items,

            p_preview_fingerprint:
              verified.fingerprint,

            p_previewed_at:
              verified.issued_at,
          },
        );

      if (error) {
        return rpcErrorResponse(
          error,
        );
      }

      return json({
        ok: true,

        archive_id:
          archiveId,

        resolution:
          data,
      });
    }

    return json(
      {
        ok: false,
        error:
          "INVALID_POST_CLOSE_REVIEW_ACTION",
      },
      400,
    );
  } catch (error) {
    const message =
      error?.message
      ?? String(error);

    console.error(
      "staff-post-close-review-resolve failed",
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
      accessErrorStatus(
        message,
      ),
    );
  }
}


export const config = {
  path:
    "/api/staff-post-close-review-resolve",
};
