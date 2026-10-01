import {
  json,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
} from "../../src/lib/staff-access.mjs";


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

    let allowedLineGroupIds = null;

    if (!auth.actor?.is_admin) {
      const {
        data: assignments,
        error: assignmentError,
      } = await supabase
        .from("line_group_staff_assignments")
        .select("line_group_id")
        .eq(
          "staff_id",
          auth.actor.staff_id,
        )
        .eq("enabled", true);

      if (assignmentError) {
        throw assignmentError;
      }

      allowedLineGroupIds = [
        ...new Set(
          (assignments ?? [])
            .map(
              (row) =>
                String(
                  row.line_group_id ?? "",
                ).trim(),
            )
            .filter(Boolean),
        ),
      ];

      if (!allowedLineGroupIds.length) {
        return json({
          ok: true,
          open_session: null,
          closed_sessions: [],
          line_groups: [],
        });
      }
    }

    let sessionIds = null;

    if (allowedLineGroupIds) {
      const {
        data: configs,
        error: configError,
      } = await supabase
        .from(
          "settlement_line_group_config",
        )
        .select(
          "settlement_session_id,line_group_id",
        )
        .in(
          "line_group_id",
          allowedLineGroupIds,
        );

      if (configError) {
        throw configError;
      }

      sessionIds = [
        ...new Set(
          (configs ?? [])
            .map(
              (row) =>
                row.settlement_session_id,
            )
            .filter(Boolean),
        ),
      ];

      if (!sessionIds.length) {
        return json({
          ok: true,
          open_session: null,
          closed_sessions: [],
          line_groups: [],
        });
      }
    }

    let sessionQuery =
      supabase
        .from("settlement_sessions")
        .select(
          "id,business_date,status,opened_at,closed_at",
        )
        .order(
          "opened_at",
          {
            ascending: false,
          },
        )
        .limit(100);

    if (sessionIds) {
      sessionQuery =
        sessionQuery.in(
          "id",
          sessionIds,
        );
    }

    const {
      data: sessions,
      error: sessionError,
    } = await sessionQuery;

    if (sessionError) {
      throw sessionError;
    }

    let lineQuery =
      supabase
        .from("line_groups")
        .select(
          "line_group_id,line_group_name",
        )
        .eq("enabled", true)
        .order("line_group_name");

    if (allowedLineGroupIds) {
      lineQuery =
        lineQuery.in(
          "line_group_id",
          allowedLineGroupIds,
        );
    }

    const {
      data: lineGroups,
      error: lineError,
    } = await lineQuery;

    if (lineError) {
      throw lineError;
    }

    const rows =
      sessions ?? [];

    const openSession =
      rows.find(
        (row) =>
          row.status === "OPEN",
      ) ?? null;

    const closedSessions =
      rows
        .filter(
          (row) =>
            row.status === "CLOSED",
        )
        .sort(
          (a, b) =>
            String(
              b.closed_at
              ?? b.opened_at
              ?? "",
            ).localeCompare(
              String(
                a.closed_at
                ?? a.opened_at
                ?? "",
              ),
            ),
        );

    return json({
      ok: true,
      open_session: openSession,
      closed_sessions: closedSessions,
      line_groups: lineGroups ?? [],
    });
  } catch (error) {
    console.error(
      "staff-report-sessions failed",
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
    "/api/staff-report-sessions",
};
