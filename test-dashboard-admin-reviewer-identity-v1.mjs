import assert from "node:assert/strict";

import {
  authenticateWorkbenchActor,
} from "./src/lib/staff-access.mjs";

function requestWithDashboardKey(key) {
  return new Request(
    "https://example.test/api/staff-me",
    {
      headers: {
        "x-dashboard-key": key,
      },
    },
  );
}

function reviewerClient(
  row,
  {
    onQuery = () => {},
  } = {},
) {
  return {
    from(name) {
      assert.equal(
        name,
        "staff_accounts",
      );

      const filters = [];

      const query = {
        select() {
          return query;
        },

        eq(field, value) {
          filters.push([
            field,
            value,
          ]);

          return query;
        },

        async maybeSingle() {
          onQuery(filters);

          return {
            data: row,
            error: null,
          };
        },
      };

      return query;
    },
  };
}

{
  let tableRead = false;

  const auth =
    await authenticateWorkbenchActor(
      requestWithDashboardKey(
        "dashboard-secret",
      ),
      {
        client: {
          from() {
            tableRead = true;
            throw new Error(
              "UNEXPECTED_TABLE_READ",
            );
          },
        },
        dashboardAccessKey:
          "dashboard-secret",
        dashboardOperatorName:
          "Admin Operator",
        dashboardReviewerStaffCode:
          "",
      },
    );

  assert.equal(
    auth.ok,
    true,
  );

  assert.equal(
    auth.actor.kind,
    "DASHBOARD",
  );

  assert.equal(
    auth.actor.staff_id,
    null,
  );

  assert.equal(
    auth.actor.staff_code,
    "ADMIN",
  );

  assert.equal(
    auth.actor.display_name,
    "Admin Operator",
  );

  assert.equal(
    auth.actor.is_admin,
    true,
  );

  assert.equal(
    tableRead,
    false,
  );
}

{
  const adminRow = {
    id:
      "11111111-1111-4111-8111-111111111111",
    staff_code:
      "ADMIN01",
    display_name:
      "Named Admin",
    role:
      "ADMIN",
    enabled:
      true,
  };

  const auth =
    await authenticateWorkbenchActor(
      requestWithDashboardKey(
        "dashboard-secret",
      ),
      {
        client:
          reviewerClient(
            adminRow,
            {
              onQuery(filters) {
                assert.deepEqual(
                  filters,
                  [
                    [
                      "staff_code",
                      "ADMIN01",
                    ],
                    [
                      "role",
                      "ADMIN",
                    ],
                    [
                      "enabled",
                      true,
                    ],
                  ],
                );
              },
            },
          ),
        dashboardAccessKey:
          "dashboard-secret",
        dashboardOperatorName:
          "Legacy Operator",
        dashboardReviewerStaffCode:
          "ADMIN01",
      },
    );

  assert.equal(
    auth.ok,
    true,
  );

  assert.equal(
    auth.actor.kind,
    "DASHBOARD",
  );

  assert.equal(
    auth.actor.staff_id,
    adminRow.id,
  );

  assert.equal(
    auth.actor.staff_code,
    "ADMIN01",
  );

  assert.equal(
    auth.actor.display_name,
    "Named Admin",
  );

  assert.equal(
    auth.actor.role,
    "ADMIN",
  );

  assert.equal(
    auth.actor.is_admin,
    true,
  );
}

{
  const auth =
    await authenticateWorkbenchActor(
      requestWithDashboardKey(
        "dashboard-secret",
      ),
      {
        client:
          reviewerClient(
            null,
          ),
        dashboardAccessKey:
          "dashboard-secret",
        dashboardOperatorName:
          "Admin Operator",
        dashboardReviewerStaffCode:
          "MISSING_ADMIN",
      },
    );

  assert.equal(
    auth.ok,
    true,
  );

  assert.equal(
    auth.actor.kind,
    "DASHBOARD",
  );

  assert.equal(
    auth.actor.staff_id,
    null,
  );

  assert.equal(
    auth.actor.display_name,
    "Admin Operator",
  );
}

console.log(
  "PASS: Dashboard Admin reviewer identity v1",
);
