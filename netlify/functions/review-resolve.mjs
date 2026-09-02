import {
  parseOrder,
} from "../../src/lib/order-parser.mjs";

import {
  firstLedgerCode,
} from "../../src/lib/report-ledger.mjs";

import {
  reviewPreviewFingerprint,
  verifyReviewPreviewToken,
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
  normalizeLeaseVersion,
} from "../../src/lib/staff-work-claim.mjs";

import {
  loadStaffReviewPreviewAccess,
} from "../../src/lib/staff-review-access.mjs";


const OPERATOR =
  process.env.DASHBOARD_OPERATOR_NAME
  || "DASHBOARD";


const CLAIM_CONFLICT_CODES =
  new Set([
    "LEASE_VERSION_REQUIRED",
    "CLAIM_REQUIRED",
    "CLAIM_EXPIRED",
    "CLAIM_OWNED_BY_OTHER",
    "STALE_CLAIM_VERSION",
    "MESSAGE_OUTSIDE_CURRENT_SETTLEMENT",
    "MESSAGE_ROUND_NOT_CURRENT",
    "MESSAGE_LINE_GROUP_CONFIG_MISMATCH",
    "MESSAGE_OUTSIDE_STAFF_SCOPE",
    "STAFF_NOT_ACTIVE",
  ]);


function isClaimConflict(
  code,
) {
  return CLAIM_CONFLICT_CODES.has(
    code,
  );
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
      "REVIEW_NOT_FOUND",
      404,
    ],
    [
      "MESSAGE_NOT_FOUND",
      404,
    ],
    [
      "INVALID_REVIEW_ID",
      400,
    ],
    [
      "REVIEW_NOT_OPEN",
      409,
    ],
    [
      "MESSAGE_ALREADY_UNSENT",
      409,
    ],
    [
      "MESSAGE_GROUP_NOT_CONFIGURED",
      409,
    ],
    [
      "SETTLEMENT_NOT_OPEN",
      409,
    ],
    [
      "MESSAGE_SETTLEMENT_NOT_ASSIGNED",
      409,
    ],
    [
      "MESSAGE_OUTSIDE_CURRENT_SETTLEMENT",
      409,
    ],
    [
      "MESSAGE_ROUND_NOT_CURRENT",
      409,
    ],
    [
      "MESSAGE_LINE_GROUP_CONFIG_MISMATCH",
      409,
    ],
    [
      "MESSAGE_OUTSIDE_STAFF_SCOPE",
      409,
    ],
    [
      "REVIEW_MESSAGE_CHANGED",
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
        isClaimConflict(
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


function staffResolvedBy(
  actor,
) {
  const staffCode =
    String(
      actor?.staff_code
      ?? "",
    ).trim();

  if (staffCode) {
    return `STAFF:${staffCode}`;
  }

  return "STAFF";
}


export default async (
  req,
) => {
  if (
    req.method !== "POST"
  ) {
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
    // Explicit Staff credential selects the Staff path.
    //
    // Dashboard/Admin keeps the legacy path and RPCs.
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

    const action =
      String(
        body.action
        ?? "CORRECT",
      )
        .trim()
        .toUpperCase();


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
      action !== "CORRECT"
      && action !== "IGNORE"
    ) {
      return json(
        {
          ok: false,
          error:
            "INVALID_REVIEW_ACTION",
        },
        400,
      );
    }


    const expectedLeaseVersion =
      staffContext
        ? normalizeLeaseVersion(
            body.lease_version,
          )
        : null;


    if (
      staffContext
      && !expectedLeaseVersion
    ) {
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


    let message;

    if (staffContext) {
      // Read-time scope check prevents arbitrary Staff review probing.
      //
      // The mutation wrapper re-checks the same boundary atomically.
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
    }


    const resolvedBy =
      staffContext
        ? staffResolvedBy(
            staffContext.actor,
          )
        : OPERATOR;


    // ==========================================================
    // IGNORE
    // ==========================================================

    if (
      action === "IGNORE"
    ) {
      const rpcName =
        staffContext
          ? "ignore_staff_review"
          : "ignore_review";

      const rpcArgs =
        staffContext
          ? {
              p_review_id:
                reviewId,

              p_resolved_by:
                resolvedBy,

              p_staff_id:
                staffContext
                  .actor
                  .staff_id,

              p_allowed_line_group_ids:
                staffContext
                  .lineGroupIds,

              p_settlement_session_id:
                staffContext
                  .session
                  .id,

              p_expected_lease_version:
                expectedLeaseVersion,
            }
          : {
              p_review_id:
                reviewId,

              p_resolved_by:
                resolvedBy,
            };

      const {
        data,
        error,
      } =
        await supabase.rpc(
          rpcName,
          rpcArgs,
        );

      if (error) {
        return rpcErrorResponse(
          error,
        );
      }

      return json({
        ok: true,
        resolution:
          data,
      });
    }


    // ==========================================================
    // CORRECT
    // ==========================================================

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


    const correctedText =
      String(
        body.corrected_text
        ?? "",
      );

    const previewToken =
      String(
        body.preview_token
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
        },
        428,
      );
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


    const verified =
      verifyReviewPreviewToken({
        token:
          previewToken,

        reviewId,

        messageRecordId:
          message.id,

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


    const rpcName =
      staffContext
        ? "resolve_staff_review_with_preview"
        : "resolve_review_with_preview";


    const rpcArgs =
      staffContext
        ? {
            p_review_id:
              reviewId,

            p_corrected_text:
              result.normalized_text,

            p_parser_version:
              result.parser_version,

            p_items:
              result.items,

            p_resolved_by:
              resolvedBy,

            p_preview_fingerprint:
              verified.fingerprint,

            p_previewed_at:
              verified.issued_at,

            p_staff_id:
              staffContext
                .actor
                .staff_id,

            p_allowed_line_group_ids:
              staffContext
                .lineGroupIds,

            p_settlement_session_id:
              staffContext
                .session
                .id,

            p_expected_lease_version:
              expectedLeaseVersion,
          }
        : {
            p_review_id:
              reviewId,

            p_corrected_text:
              result.normalized_text,

            p_parser_version:
              result.parser_version,

            p_items:
              result.items,

            p_resolved_by:
              resolvedBy,

            p_preview_fingerprint:
              verified.fingerprint,

            p_previewed_at:
              verified.issued_at,
          };


    const {
      data,
      error,
    } =
      await supabase.rpc(
        rpcName,
        rpcArgs,
      );


    if (error) {
      return rpcErrorResponse(
        error,
      );
    }


    // Existing compact first-code metadata remains best-effort.
    //
    // Canonical Review mutation has already committed successfully
    // before this non-critical metadata write.
    const firstOrderCode =
      firstLedgerCode(
        result.items,
        correctedText,
      )
      || null;


    const {
      error:
        firstCodeError,
    } =
      await supabase
        .from("messages")
        .update({
          first_order_code:
            firstOrderCode,
        })
        .eq(
          "id",
          message.id,
        );


    if (firstCodeError) {
      console.warn(
        "failed to update first_order_code after review resolution",
        firstCodeError,
      );
    }


    return json({
      ok: true,

      resolution:
        data,

      items:
        result.items,

      preview_fingerprint:
        verified.fingerprint,
    });
  } catch (error) {
    const message =
      error?.message
      ?? String(error);

    console.error(
      "review-resolve failed",
      error,
    );

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
          isClaimConflict(
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
};


export const config = {
  path:
    "/api/review-resolve",
};
