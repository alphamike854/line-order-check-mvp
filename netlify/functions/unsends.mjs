import {
  fetchOpenSettlementSession,
  fetchUnsends,
  json,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  loadDashboardRoundContext,
} from "../../src/lib/dashboard-round-context.mjs";


export default async function handler(req) {
  if (req.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  const denied =
    requireDashboardAccess(req);

  if (denied) {
    return denied;
  }

  try {
    const session =
      await fetchOpenSettlementSession();

    if (!session) {
      return json({
        ok: true,
        items: [],
      });
    }

    const url =
      new URL(req.url);

    const group =
      normalizeSummaryGroup(
        url.searchParams.get(
          "group",
        ),
      );

    const roundContext =
      await loadDashboardRoundContext({
        supabase,
        settlementSessionId:
          session.id,
        summaryGroupId:
          group,
      });

    const items =
      await fetchUnsends(
        roundContext.roundIds,
        group,
      );

    return json({
      ok: true,

      settlement_session:
        session,

      business_date:
        roundContext.businessDate,

      business_dates:
        roundContext.businessDates,

      current_rounds:
        roundContext.rounds,

      items,
    });
  } catch (error) {
    console.error(
      "unsends failed",
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
  path: "/api/unsends",
};
