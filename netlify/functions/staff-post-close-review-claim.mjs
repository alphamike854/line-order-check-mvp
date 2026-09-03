import {
  json,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
  loadWorkbenchActorLineGroups,
} from "../../src/lib/staff-access.mjs";

import {
  claimStaffPostCloseReviewWork,
  normalizePostCloseArchiveId,
  normalizePostCloseClaimAction,
  normalizePostCloseClaimLeaseSeconds,
  normalizePostCloseLeaseVersion,
  releaseStaffPostCloseReviewWork,
} from "../../src/lib/staff-post-close-review-claim.mjs";


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


    // Post-close ownership requires an auditable
    // real Staff identity.
    //
    // Shared Dashboard credentials cannot own
    // post-close work.
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
      normalizePostCloseClaimAction(
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


    // Browser chooses only the durable work-item identity.
    //
    // Staff identity and LINE Group authorization are
    // always resolved server-side.
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


    // Post-close authorization intentionally follows
    // current enabled Staff <-> LINE Group assignments.
    //
    // It does NOT depend on an OPEN Settlement,
    // current Round, or settlement snapshot.
    const lineGroups =
      await loadWorkbenchActorLineGroups(
        supabase,
        auth.actor,
      );

    const allowedLineGroupIds =
      [
        ...new Set(
          (lineGroups ?? [])
            .map(
              (row) =>
                row?.line_group_id,
            )
            .filter(Boolean),
        ),
      ];

    if (
      !allowedLineGroupIds.length
    ) {
      return json(
        {
          ok: false,
          error:
            "NO_ASSIGNED_LINE_GROUPS",
        },
        403,
      );
    }


    // RELEASE is an ownership-sensitive mutation.
    //
    // The browser must present the exact lease version it observed.
    // Missing or stale browser state must never release a newer
    // lease belonging to the same Staff account.
    const expectedLeaseVersion =
      action === "RELEASE"
        ? normalizePostCloseLeaseVersion(
            body?.lease_version,
          )
        : null;

    if (
      action === "RELEASE"
      && !expectedLeaseVersion
    ) {
      return json(
        {
          ok: false,
          error:
            "INVALID_LEASE_VERSION",
        },
        400,
      );
    }


    let result;

    if (action === "CLAIM") {
      result =
        await claimStaffPostCloseReviewWork(
          supabase,
          {
            archiveId,

            staffId:
              auth.actor.staff_id,

            allowedLineGroupIds,

            leaseSeconds:
              normalizePostCloseClaimLeaseSeconds(
                body?.lease_seconds,
              ),
          },
        );
    } else {
      result =
        await releaseStaffPostCloseReviewWork(
          supabase,
          {
            archiveId,

            staffId:
              auth.actor.staff_id,

            allowedLineGroupIds,

            expectedLeaseVersion,
          },
        );
    }


    if (
      result?.ok === false
      && (
        result?.status
          === "BUSY"
        || result?.status
          === "CLAIM_OWNED_BY_OTHER"
        || result?.status
          === "STALE_CLAIM_VERSION"
      )
    ) {
      return json(
        {
          ok: false,

          error:
            result?.status
            ?? "CLAIM_CONFLICT",

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
      "staff-post-close-review-claim failed",
      error,
    );

    const message =
      error?.message
      ?? String(error);


    // Missing and unauthorized archive identities are
    // deliberately indistinguishable.
    if (
      message
        === "POST_CLOSE_REVIEW_NOT_FOUND"
    ) {
      return json(
        {
          ok: false,
          error:
            "POST_CLOSE_REVIEW_NOT_FOUND",
        },
        404,
      );
    }


    const conflictErrors =
      new Set([
        "STAFF_NOT_ACTIVE",
      ]);

    const clientErrors =
      new Set([
        "ARCHIVE_ID_REQUIRED",
        "STAFF_ID_REQUIRED",
      ]);


    if (
      conflictErrors.has(
        message,
      )
    ) {
      return json(
        {
          ok: false,
          error:
            message,
        },
        409,
      );
    }


    if (
      clientErrors.has(
        message,
      )
    ) {
      return json(
        {
          ok: false,
          error:
            message,
        },
        400,
      );
    }


    return json(
      {
        ok: false,
        error:
          message,
      },
      500,
    );
  }
}


export const config = {
  path:
    "/api/staff-post-close-review-claim",
};
