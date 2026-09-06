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
  normalizeClaimAction,
  normalizeClaimLeaseSeconds,
  normalizeLeaseVersion,
  normalizeMessageRecordId,
} from "../../src/lib/staff-work-claim.mjs";

import {
  claimStaffMessageVerificationWork,
  releaseStaffMessageVerificationWork,
} from "../../src/lib/staff-message-verification.mjs";


const CLAIM_CONFLICTS =
  new Set([
    "BUSY",
    "CLAIM_OWNED_BY_OTHER",
    "STALE_CLAIM_VERSION",
  ]);


const KNOWN_CLIENT_ERRORS =
  new Set([
    "MESSAGE_NOT_FOUND",
    "MESSAGE_ALREADY_UNSENT",
    "MESSAGE_ALREADY_VERIFIED",
    "MESSAGE_OUTSIDE_STAFF_SCOPE",
    "MESSAGE_OUTSIDE_CURRENT_SETTLEMENT",
    "MESSAGE_ROUND_NOT_CURRENT",
    "MESSAGE_LINE_GROUP_CONFIG_MISMATCH",
    "MESSAGE_NOT_READY_FOR_VERIFICATION",
    "MESSAGE_HAS_NO_ORDER_ITEMS",
    "SETTLEMENT_NOT_OPEN",
    "NO_OPEN_SETTLEMENT",
    "STAFF_NOT_ACTIVE",
  ]);


export default async function handler(req) {
  if (req.method !== "POST") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
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
          error: auth.error,
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
          error: "INVALID_JSON",
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
          error: "INVALID_ACTION",
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

    if (
      action === "RELEASE"
      && !leaseVersion
    ) {
      return json(
        {
          ok: false,
          error:
            "LEASE_VERSION_REQUIRED",
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


    const result =
      action === "CLAIM"
        ? await claimStaffMessageVerificationWork(
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
          )
        : await releaseStaffMessageVerificationWork(
            supabase,
            {
              messageRecordId,

              staffId:
                auth.actor.staff_id,

              settlementSessionId:
                session.id,

              expectedLeaseVersion:
                leaseVersion,
            },
          );


    if (
      result?.ok === false
      && CLAIM_CONFLICTS.has(
        result?.status,
      )
    ) {
      return json(
        {
          ok: false,
          error:
            result.status,
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
      "staff-verification-claim failed",
      error,
    );

    const message =
      error?.message
      ?? String(error);

    return json(
      {
        ok: false,
        error: message,
      },
      KNOWN_CLIENT_ERRORS.has(
        message,
      )
        ? 409
        : 500,
    );
  }
}


export const config = {
  path:
    "/api/staff-verification-claim",
};
