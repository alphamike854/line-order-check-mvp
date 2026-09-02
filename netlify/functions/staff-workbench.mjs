import {
  fetchOpenSettlementSession,
  json,
  normalizeSummaryGroup,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
} from "../../src/lib/staff-access.mjs";

import {
  buildStaffWorkbenchPayload,
  loadActorSessionLineGroupIds,
  loadStaffWorkbenchReadModel,
  normalizeWorkbenchLimit,
  normalizeWorkbenchOffset,
} from "../../src/lib/staff-workbench.mjs";


export default async function handler(req) {
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

    const url =
      new URL(req.url);

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

    const session =
      await fetchOpenSettlementSession();

    if (!session) {
      return json({
        ok: true,

        ...buildStaffWorkbenchPayload({
          actor:
            auth.actor,

          session:
            null,

          summaryRows:
            [],

          workItems:
            [],

          limit,
          offset,
        }),
      });
    }

    const lineGroupIds =
      await loadActorSessionLineGroupIds(
        supabase,
        auth.actor,
        session.id,
      );

    const {
      summaryRows,
      workItems,
    } =
      await loadStaffWorkbenchReadModel(
        supabase,
        {
          settlementSessionId:
            session.id,

          lineGroupIds,

          summaryGroupId,

          limit,
          offset,
        },
      );

    return json({
      ok: true,

      ...buildStaffWorkbenchPayload({
        actor:
          auth.actor,

        session,

        summaryRows,
        workItems,

        limit,
        offset,
      }),
    });
  } catch (error) {
    console.error(
      "staff-workbench failed",
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
    "/api/staff-workbench",
};
