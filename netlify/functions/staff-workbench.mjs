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

    // Legacy Review pagination.
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

    // RECENT Human Verification pagination.
    const verificationLimit =
      normalizeWorkbenchLimit(
        url.searchParams.get(
          "verification_limit",
        ),
      );

    const verificationOffset =
      normalizeWorkbenchOffset(
        url.searchParams.get(
          "verification_offset",
        ),
      );

    // PRIORITY / Attention pagination.
    const attentionLimit =
      normalizeWorkbenchLimit(
        url.searchParams.get(
          "attention_limit",
        ),
      );

    const attentionOffset =
      normalizeWorkbenchOffset(
        url.searchParams.get(
          "attention_offset",
        ),
      );

    // HIGH_TOTAL pagination.
    const highTotalLimit =
      normalizeWorkbenchLimit(
        url.searchParams.get(
          "high_total_limit",
        ),
      );

    const highTotalOffset =
      normalizeWorkbenchOffset(
        url.searchParams.get(
          "high_total_offset",
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

          verificationItems:
            [],

          attentionItems:
            [],

          highTotalItems:
            [],

          limit,
          offset,

          verificationLimit,
          verificationOffset,

          attentionLimit,
          attentionOffset,

          highTotalLimit,
          highTotalOffset,
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
      verificationItems,
      attentionItems,
      highTotalItems,
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

          verificationLimit,
          verificationOffset,

          attentionLimit,
          attentionOffset,

          highTotalLimit,
          highTotalOffset,
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

        verificationItems,
        attentionItems,
        highTotalItems,

        limit,
        offset,

        verificationLimit,
        verificationOffset,

        attentionLimit,
        attentionOffset,

        highTotalLimit,
        highTotalOffset,
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
