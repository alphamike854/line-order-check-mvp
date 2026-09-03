import {
  json,
  normalizeSummaryGroup,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
  loadWorkbenchActorLineGroups,
} from "../../src/lib/staff-access.mjs";

import {
  normalizeWorkbenchLimit,
  normalizeWorkbenchOffset,
} from "../../src/lib/staff-workbench.mjs";

import {
  buildStaffPostCloseReviewItem,
  loadStaffPostCloseReviewClaimState,
  loadStaffPostCloseReviewReadModel,
} from "../../src/lib/staff-post-close-review.mjs";


export default async function handler(
  req,
) {
  if (req.method !== "GET") {
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

    // Post-close Review is Staff-only.
    //
    // A shared Dashboard/Admin credential must not become
    // an identity for historical Staff work.
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

    const url =
      new URL(
        req.url,
      );

    const summaryGroupId =
      normalizeSummaryGroup(
        url.searchParams.get(
          "group",
        ),
      );

    const limit =
      normalizeWorkbenchLimit(
        url.searchParams.get(
          "limit",
        ),
      );

    const offset =
      normalizeWorkbenchOffset(
        url.searchParams.get(
          "offset",
        ),
      );

    // Authorization is deliberately based on current
    // Staff <-> LINE Group assignments.
    //
    // Historical settlement membership and Summary Group
    // ownership come only from the durable archive itself.
    const lineGroups =
      await loadWorkbenchActorLineGroups(
        supabase,
        auth.actor,
      );

    const lineGroupNameById =
      new Map(
        (lineGroups ?? [])
          .map(
            (row) => [
              row.line_group_id,
              row.line_group_name
                ?? row.line_group_id,
            ],
          ),
      );

    const lineGroupIds =
      [
        ...lineGroupNameById.keys(),
      ];

    const {
      rows,
      total,
      limit:
        resolvedLimit,
      offset:
        resolvedOffset,
    } =
      await loadStaffPostCloseReviewReadModel(
        supabase,
        {
          lineGroupIds,
          summaryGroupId,
          limit,
          offset,
        },
      );

    // Claim-state read is bounded to the exact archive IDs
    // returned by this page.
    const archiveIds =
      rows
        .map(
          (row) =>
            row?.id,
        )
        .filter(Boolean);

    const claimRows =
      await loadStaffPostCloseReviewClaimState(
        supabase,
        archiveIds,
      );

    const claimByArchiveId =
      new Map(
        (claimRows ?? [])
          .map(
            (claim) => [
              claim?.archive_id,
              claim,
            ],
          )
          .filter(
            ([archiveId]) =>
              Boolean(archiveId),
          ),
      );

    const items =
      rows.map(
        (row) =>
          buildStaffPostCloseReviewItem(
            row,
            {
              lineGroupName:
                lineGroupNameById.get(
                  row.line_group_id,
                )
                ?? row.line_group_id,

              claim:
                claimByArchiveId.get(
                  row?.id,
                )
                ?? null,

              actorStaffId:
                auth.actor.staff_id,
            },
          ),
      );

    return json({
      ok: true,

      actor: {
        kind:
          auth.actor.kind,
        staff_id:
          auth.actor.staff_id,
        staff_code:
          auth.actor.staff_code,
        display_name:
          auth.actor.display_name,
        role:
          auth.actor.role,
        is_admin:
          auth.actor.is_admin,
      },

      scope: {
        kind:
          "POST_CLOSE_REVIEW",
        summary_group_id:
          summaryGroupId,
      },

      items,

      pagination: {
        limit:
          resolvedLimit,
        offset:
          resolvedOffset,
        returned:
          items.length,
        total,
        has_more:
          resolvedOffset
            + items.length
          < total,
      },
    });
  } catch (error) {
    console.error(
      "staff-post-close-reviews failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error?.message
          ?? String(error),
      },
      500,
    );
  }
}


export const config = {
  path:
    "/api/staff-post-close-reviews",
};
