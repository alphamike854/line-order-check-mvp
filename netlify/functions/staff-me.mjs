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

    const lineGroups =
      await loadWorkbenchActorLineGroups(
        supabase,
        auth.actor,
      );

    return json({
      ok: true,

      actor: {
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
};
