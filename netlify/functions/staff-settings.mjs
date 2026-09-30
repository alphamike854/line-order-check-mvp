import {
  randomBytes,
} from "node:crypto";

import {
  json,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  hashStaffAccessKey,
} from "../../src/lib/staff-access.mjs";

const OPERATOR =
  process.env.DASHBOARD_OPERATOR_NAME
  || "DASHBOARD";

const STAFF_ROLES = new Set([
  "ADMIN",
  "SUPERVISOR",
  "STAFF",
]);

const ASSIGNMENT_ROLES = new Set([
  "REVIEWER",
  "SUPERVISOR",
]);

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeStaffCode(value) {
  const code = text(value).toUpperCase();

  if (
    !code
    || code.length > 50
    || !/^[A-Z0-9][A-Z0-9._-]*$/.test(code)
  ) {
    throw new Error(
      "INVALID_STAFF_CODE",
    );
  }

  return code;
}

export function normalizeDisplayName(value) {
  const displayName = text(value);

  if (
    !displayName
    || displayName.length > 120
  ) {
    throw new Error(
      "INVALID_STAFF_DISPLAY_NAME",
    );
  }

  return displayName;
}

export function normalizeStaffRole(value) {
  const role =
    text(value || "STAFF").toUpperCase();

  if (!STAFF_ROLES.has(role)) {
    throw new Error(
      "INVALID_STAFF_ROLE",
    );
  }

  return role;
}

export function normalizeAssignmentRole(value) {
  const role =
    text(value || "REVIEWER")
      .toUpperCase();

  if (!ASSIGNMENT_ROLES.has(role)) {
    throw new Error(
      "INVALID_ASSIGNMENT_ROLE",
    );
  }

  return role;
}

export function generateStaffAccessKey() {
  return randomBytes(32)
    .toString("base64url");
}

function publicStaff(row) {
  return {
    id: row.id,
    staff_code: row.staff_code,
    display_name: row.display_name,
    role: row.role,
    enabled: row.enabled === true,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function getStaff(id) {
  const {
    data,
    error,
  } = await supabase
    .from("staff_accounts")
    .select(
      "id,staff_code,display_name,role,enabled,created_at,updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error(
      "STAFF_NOT_FOUND",
    );
  }

  return data;
}

async function readStaffSettings() {
  const [
    staffResult,
    lineGroupResult,
    assignmentResult,
  ] = await Promise.all([
    supabase
      .from("staff_accounts")
      .select(
        "id,staff_code,display_name,role,enabled,created_at,updated_at",
      )
      .order(
        "staff_code",
        { ascending: true },
      ),

    supabase
      .from("line_groups")
      .select(
        "line_group_id,line_group_name,summary_group_id,enabled",
      )
      .eq(
        "enabled",
        true,
      )
      .order(
        "line_group_name",
        { ascending: true },
      ),

    supabase
      .from(
        "line_group_staff_assignments",
      )
      .select(
        "line_group_id,staff_id,assignment_role,enabled,assigned_at,updated_at",
      ),
  ]);

  if (staffResult.error) {
    throw staffResult.error;
  }

  if (lineGroupResult.error) {
    throw lineGroupResult.error;
  }

  if (assignmentResult.error) {
    throw assignmentResult.error;
  }

  return {
    staff:
      (staffResult.data || [])
        .map(publicStaff),

    line_groups:
      lineGroupResult.data || [],

    assignments:
      assignmentResult.data || [],
  };
}

async function createStaff(values) {
  const staffCode =
    normalizeStaffCode(
      values?.staff_code,
    );

  const displayName =
    normalizeDisplayName(
      values?.display_name,
    );

  const role =
    normalizeStaffRole(
      values?.role,
    );

  const accessKey =
    generateStaffAccessKey();

  const accessKeyHash =
    hashStaffAccessKey(
      accessKey,
    );

  const now =
    new Date().toISOString();

  const {
    data,
    error,
  } = await supabase
    .from("staff_accounts")
    .insert({
      staff_code:
        staffCode,

      display_name:
        displayName,

      role,

      access_key_hash:
        accessKeyHash,

      enabled:
        true,

      created_by:
        OPERATOR,

      updated_at:
        now,
    })
    .select(
      "id,staff_code,display_name,role,enabled,created_at,updated_at",
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "STAFF_CODE_EXISTS",
      );
    }

    throw error;
  }

  return {
    staff:
      publicStaff(data),

    // Intentionally returned exactly once.
    // Plaintext is never written to the database.
    access_key:
      accessKey,

    key_delivery:
      "ONE_TIME",
  };
}

async function resetStaffKey(staffId) {
  const staff =
    await getStaff(staffId);

  const accessKey =
    generateStaffAccessKey();

  const accessKeyHash =
    hashStaffAccessKey(
      accessKey,
    );

  const {
    data,
    error,
  } = await supabase
    .from("staff_accounts")
    .update({
      access_key_hash:
        accessKeyHash,

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      staff.id,
    )
    .select(
      "id,staff_code,display_name,role,enabled,created_at,updated_at",
    )
    .single();

  if (error) throw error;

  return {
    staff:
      publicStaff(data),

    access_key:
      accessKey,

    key_delivery:
      "ONE_TIME",
  };
}

async function setStaffEnabled(
  staffId,
  enabled,
) {
  if (typeof enabled !== "boolean") {
    throw new Error(
      "INVALID_STAFF_ENABLED",
    );
  }

  await getStaff(staffId);

  const {
    data,
    error,
  } = await supabase
    .from("staff_accounts")
    .update({
      enabled,
      updated_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      staffId,
    )
    .select(
      "id,staff_code,display_name,role,enabled,created_at,updated_at",
    )
    .single();

  if (error) throw error;

  return {
    staff:
      publicStaff(data),
  };
}

async function setAssignment(values) {
  const staffId =
    text(values?.staff_id);

  const lineGroupId =
    text(values?.line_group_id);

  if (!staffId) {
    throw new Error(
      "INVALID_STAFF_ID",
    );
  }

  if (!lineGroupId) {
    throw new Error(
      "INVALID_LINE_GROUP_ID",
    );
  }

  if (
    typeof values?.enabled
      !== "boolean"
  ) {
    throw new Error(
      "INVALID_ASSIGNMENT_ENABLED",
    );
  }

  const staff =
    await getStaff(staffId);

  if (staff.role === "ADMIN") {
    throw new Error(
      "ADMIN_ASSIGNMENT_NOT_REQUIRED",
    );
  }

  const {
    data: lineGroup,
    error: lineGroupError,
  } = await supabase
    .from("line_groups")
    .select(
      "line_group_id,enabled",
    )
    .eq(
      "line_group_id",
      lineGroupId,
    )
    .eq(
      "enabled",
      true,
    )
    .maybeSingle();

  if (lineGroupError) {
    throw lineGroupError;
  }

  if (!lineGroup) {
    throw new Error(
      "LINE_GROUP_NOT_FOUND",
    );
  }

  const assignmentRole =
    normalizeAssignmentRole(
      values?.assignment_role,
    );

  const now =
    new Date().toISOString();

  const {
    data,
    error,
  } = await supabase
    .from(
      "line_group_staff_assignments",
    )
    .upsert(
      {
        line_group_id:
          lineGroupId,

        staff_id:
          staff.id,

        assignment_role:
          assignmentRole,

        enabled:
          values.enabled,

        assigned_by:
          OPERATOR,

        updated_at:
          now,
      },
      {
        onConflict:
          "line_group_id,staff_id",
      },
    )
    .select(
      "line_group_id,staff_id,assignment_role,enabled,assigned_at,updated_at",
    )
    .single();

  if (error) throw error;

  return {
    assignment:
      data,
  };
}

function statusForError(message) {
  if (
    message === "STAFF_CODE_EXISTS"
  ) {
    return 409;
  }

  if (
    message.endsWith(
      "_NOT_FOUND",
    )
  ) {
    return 404;
  }

  if (
    message.startsWith(
      "INVALID_",
    )
    || message
      === "ADMIN_ASSIGNMENT_NOT_REQUIRED"
  ) {
    return 400;
  }

  return 500;
}

export default async (req) => {
  const denied =
    requireDashboardAccess(req);

  if (denied) {
    return denied;
  }

  try {
    if (req.method === "GET") {
      const settings =
        await readStaffSettings();

      return json({
        ok: true,
        ...settings,
      });
    }

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

    const body =
      await req.json();

    const action =
      text(body?.action)
        .toUpperCase();

    let result;

    if (action === "CREATE") {
      result =
        await createStaff(
          body.values || {},
        );
    } else if (
      action === "RESET_KEY"
    ) {
      result =
        await resetStaffKey(
          text(
            body?.values?.staff_id,
          ),
        );
    } else if (
      action === "SET_ENABLED"
    ) {
      result =
        await setStaffEnabled(
          text(
            body?.values?.staff_id,
          ),
          body?.values?.enabled,
        );
    } else if (
      action === "SET_ASSIGNMENT"
    ) {
      result =
        await setAssignment(
          body.values || {},
        );
    } else {
      return json(
        {
          ok: false,
          error:
            "INVALID_STAFF_SETTINGS_ACTION",
        },
        400,
      );
    }

    return json({
      ok: true,
      action,
      ...result,
    });
  } catch (error) {
    const message =
      error?.message
      ?? String(error);

    console.error(
      "staff settings failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          message,
      },
      statusForError(
        message,
      ),
    );
  }
};

export const config = {
  path:
    "/api/staff-settings",
};
