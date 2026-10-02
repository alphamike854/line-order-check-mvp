import {
  json,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
  loadWorkbenchActorLineGroups,
} from "../../src/lib/staff-access.mjs";

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

          // Emergency availability:
          // Access-key classification must not require
          // a staff_accounts lookup for Dashboard auth.
          dashboardReviewerStaffCode:
            req.headers.get("x-auth-classification") === "1"
              ? ""
              : process.env.DASHBOARD_REVIEWER_STAFF_CODE,
        },
      );

    const classificationOnly =
      req.headers.get(
        "x-auth-classification",
      ) === "1";

    if (!auth.ok) {
      return json(
        {
          ok: false,
          error: auth.error,
        },
        auth.status,
      );
    }

    const lineGroups =
      classificationOnly
        ? []
        : await loadWorkbenchActorLineGroups(
            supabase,
            auth.actor,
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

      line_groups:
        lineGroups,
    });
  } catch (error) {
    console.error(
      "staff-me failed",
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
  path: "/api/staff-me",
  region: "sin",
};
