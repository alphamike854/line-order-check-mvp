import {
  createHash,
  timingSafeEqual,
} from "node:crypto";

function safeEqualString(a, b) {
  const left = Buffer.from(
    String(a ?? ""),
  );

  const right = Buffer.from(
    String(b ?? ""),
  );

  return (
    left.length === right.length
    && left.length > 0
    && timingSafeEqual(
      left,
      right,
    )
  );
}

export function hashStaffAccessKey(value) {
  const key =
    String(value ?? "").trim();

  if (!key) {
    return null;
  }

  return createHash("sha256")
    .update(
      key,
      "utf8",
    )
    .digest("hex");
}

function dashboardActor(
  displayName,
) {
  return {
    kind: "DASHBOARD",
    staff_id: null,
    staff_code: "ADMIN",
    display_name:
      displayName || "DASHBOARD",
    role: "ADMIN",
    is_admin: true,
  };
}

function staffActor(row) {
  return {
    kind: "STAFF",
    staff_id: row.id,
    staff_code: row.staff_code,
    display_name: row.display_name,
    role: row.role,
    is_admin:
      row.role === "ADMIN",
  };
}

export async function authenticateWorkbenchActor(
  req,
  {
    client,
    dashboardAccessKey =
      process.env.DASHBOARD_ACCESS_KEY,
    dashboardOperatorName =
      process.env.DASHBOARD_OPERATOR_NAME
      || "DASHBOARD",
  } = {},
) {
  if (!client) {
    throw new Error(
      "WORKBENCH_SUPABASE_CLIENT_REQUIRED",
    );
  }

  const suppliedDashboardKey =
    req.headers.get(
      "x-dashboard-key",
    ) ?? "";

  if (
    dashboardAccessKey
    && safeEqualString(
      dashboardAccessKey,
      suppliedDashboardKey,
    )
  ) {
    return {
      ok: true,
      actor: dashboardActor(
        dashboardOperatorName,
      ),
    };
  }

  const suppliedStaffKey =
    req.headers.get(
      "x-staff-key",
    ) ?? "";

  const accessKeyHash =
    hashStaffAccessKey(
      suppliedStaffKey,
    );

  if (!accessKeyHash) {
    return {
      ok: false,
      status: 401,
      error: "UNAUTHORIZED",
    };
  }

  const {
    data,
    error,
  } = await client
    .from("staff_accounts")
    .select(
      "id,staff_code,display_name,role,enabled",
    )
    .eq(
      "access_key_hash",
      accessKeyHash,
    )
    .eq(
      "enabled",
      true,
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return {
      ok: false,
      status: 401,
      error: "UNAUTHORIZED",
    };
  }

  return {
    ok: true,
    actor: staffActor(data),
  };
}

export async function loadWorkbenchActorLineGroups(
  client,
  actor,
) {
  if (!client) {
    throw new Error(
      "WORKBENCH_SUPABASE_CLIENT_REQUIRED",
    );
  }

  if (!actor) {
    throw new Error(
      "WORKBENCH_ACTOR_REQUIRED",
    );
  }

  if (actor.is_admin) {
    const {
      data,
      error,
    } = await client
      .from("line_groups")
      .select(
        "line_group_id,line_group_name,summary_group_id",
      )
      .eq(
        "enabled",
        true,
      )
      .order(
        "line_group_name",
      );

    if (error) {
      throw error;
    }

    return (
      data ?? []
    ).map((row) => ({
      ...row,
      assignment_role:
        "ADMIN",
    }));
  }

  const {
    data: assignments,
    error: assignmentError,
  } = await client
    .from(
      "line_group_staff_assignments",
    )
    .select(
      "line_group_id,assignment_role",
    )
    .eq(
      "staff_id",
      actor.staff_id,
    )
    .eq(
      "enabled",
      true,
    );

  if (assignmentError) {
    throw assignmentError;
  }

  const assigned =
    assignments ?? [];

  if (!assigned.length) {
    return [];
  }

  const assignmentByLine =
    new Map(
      assigned.map(
        (row) => [
          row.line_group_id,
          row.assignment_role,
        ],
      ),
    );

  const lineGroupIds = [
    ...assignmentByLine.keys(),
  ];

  const {
    data: groups,
    error: groupError,
  } = await client
    .from("line_groups")
    .select(
      "line_group_id,line_group_name,summary_group_id",
    )
    .in(
      "line_group_id",
      lineGroupIds,
    )
    .eq(
      "enabled",
      true,
    )
    .order(
      "line_group_name",
    );

  if (groupError) {
    throw groupError;
  }

  return (
    groups ?? []
  ).map((row) => ({
    ...row,
    assignment_role:
      assignmentByLine.get(
        row.line_group_id,
      ),
  }));
}
