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
  normalizeLeaseVersion,
  normalizeMessageRecordId,
} from "../../src/lib/staff-work-claim.mjs";

import {
  normalizeVerificationNormalizedText,
  normalizeVerificationOrderItems,
  normalizeVerificationParserVersion,
  verifyStaffMessageOrder,
} from "../../src/lib/staff-message-verification.mjs";


const VERIFICATION_CONFLICTS =
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
    "CLAIM_RELEASE_FAILED",
    "SETTLEMENT_NOT_OPEN",
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


    const parserVersion =
      normalizeVerificationParserVersion(
        body?.parser_version,
      );

    if (!parserVersion) {
      return json(
        {
          ok: false,
          error:
            "PARSER_VERSION_REQUIRED",
        },
        400,
      );
    }


    const normalizedText =
      normalizeVerificationNormalizedText(
        body?.normalized_text,
      );

    if (normalizedText === null) {
      return json(
        {
          ok: false,
          error:
            "NORMALIZED_TEXT_REQUIRED",
        },
        400,
      );
    }


    const orderItems =
      normalizeVerificationOrderItems(
        body?.items,
      );

    if (!orderItems) {
      return json(
        {
          ok: false,
          error:
            "ORDER_ITEMS_REQUIRED",
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
      await verifyStaffMessageOrder(
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

          expectedParserVersion:
            parserVersion,

          expectedNormalizedText:
            normalizedText,

          expectedOrderItems:
            orderItems,
        },
      );


    return json({
      ok: true,
      verification:
        result,
    });
  } catch (error) {
    console.error(
      "staff-verification-verify failed",
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
      VERIFICATION_CONFLICTS.has(
        message,
      )
        ? 409
        : 500,
    );
  }
}


export const config = {
  path:
    "/api/staff-verification-verify",
};
