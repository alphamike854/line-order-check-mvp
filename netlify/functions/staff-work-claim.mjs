import {
  fetchOpenSettlementSession,
  json,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
} from "../../src/lib/staff-access.mjs";

import {
  loadActorSessionLineGroupIds,
} from "../../src/lib/staff-workbench.mjs";

import {
  claimStaffReviewWork,
  normalizeClaimAction,
  normalizeClaimLeaseSeconds,
  normalizeLeaseVersion,
  normalizeMessageRecordId,
  releaseStaffReviewWork,
} from "../../src/lib/staff-work-claim.mjs";


export default async function handler(req) {
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


    // Shared legacy dashboard credential is intentionally
    // read-only for Staff ownership.
    //
    // A real Staff account is required for auditable claims.
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


    const action =
      normalizeClaimAction(
        body?.action,
      );

    if (!action) {
      return json(
        {
          ok: false,
          error:
            "INVALID_ACTION",
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


    let result;

    if (action === "CLAIM") {
      result =
        await claimStaffReviewWork(
          supabase,
          {
            messageRecordId,

            staffId:
              auth.actor.staff_id,

            allowedLineGroupIds,

            settlementSessionId:
              session.id,

            leaseSeconds:
              normalizeClaimLeaseSeconds(
                body?.lease_seconds,
              ),
          },
        );

    } else {
      result =
        await releaseStaffReviewWork(
          supabase,
          {
            messageRecordId,

            staffId:
              auth.actor.staff_id,

            settlementSessionId:
              session.id,

            expectedLeaseVersion:
              normalizeLeaseVersion(
                body?.lease_version,
              ),
          },
        );
    }


    if (
      result?.ok === false
      && (
        result?.status === "BUSY"
        || result?.status === "CLAIM_OWNED_BY_OTHER"
        || result?.status === "STALE_CLAIM_VERSION"
      )
    ) {
      return json(
        {
          ok: false,
          claim:
            result,
        },
        409,
      );
    }


    return json({
      ok: true,

      claim:
        result,
    });

  } catch (error) {
    console.error(
      "staff-work-claim failed",
      error,
    );

    const message =
      error?.message
      ?? String(error);


    const knownClientErrors =
      new Set([
        "MESSAGE_NOT_FOUND",
        "MESSAGE_ALREADY_UNSENT",
        "MESSAGE_OUTSIDE_STAFF_SCOPE",
        "MESSAGE_OUTSIDE_CURRENT_SETTLEMENT",
        "MESSAGE_ROUND_NOT_CURRENT",
        "MESSAGE_LINE_GROUP_CONFIG_MISMATCH",
        "SETTLEMENT_NOT_OPEN",
        "REVIEW_NOT_OPEN",
        "STAFF_NOT_ACTIVE",
      ]);


    return json(
      {
        ok: false,
        error:
          message,
      },

      knownClientErrors.has(
        message,
      )
        ? 409
        : 500,
    );
  }
}


export const config = {
  path:
    "/api/staff-work-claim",
};
