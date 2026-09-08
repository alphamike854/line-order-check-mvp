import assert from "node:assert/strict";

import {
  loadWorkbenchActorLineGroups,
} from "./src/lib/staff-access.mjs";

const actor = {
  kind: "DASHBOARD",
  staff_id:
    "11111111-1111-4111-8111-111111111111",
  staff_code: "ADMIN01",
  display_name: "Named Admin",
  role: "ADMIN",
  is_admin: true,
};

const expectedGroups = [
  {
    line_group_id: "LINE-A",
    line_group_name: "Group A",
    summary_group_id: "NORTH",
  },
  {
    line_group_id: "LINE-B",
    line_group_name: "Group B",
    summary_group_id: "SOUTH",
  },
];

let lineGroupsRead = 0;
let assignmentRead = 0;

const client = {
  from(name) {
    if (
      name
      === "line_group_staff_assignments"
    ) {
      assignmentRead += 1;

      throw new Error(
        "ADMIN_MUST_NOT_USE_ASSIGNMENT_SCOPE",
      );
    }

    assert.equal(
      name,
      "line_groups",
    );

    lineGroupsRead += 1;

    const query = {
      select() {
        return query;
      },

      eq(field, value) {
        assert.equal(
          field,
          "enabled",
        );

        assert.equal(
          value,
          true,
        );

        return query;
      },

      async order(field) {
        assert.equal(
          field,
          "line_group_name",
        );

        return {
          data: expectedGroups,
          error: null,
        };
      },
    };

    return query;
  },
};

const groups =
  await loadWorkbenchActorLineGroups(
    client,
    actor,
  );

assert.equal(
  lineGroupsRead,
  1,
);

assert.equal(
  assignmentRead,
  0,
);

assert.deepEqual(
  groups,
  expectedGroups.map(
    (row) => ({
      ...row,
      assignment_role: "ADMIN",
    }),
  ),
);

console.log(
  "PASS: Dashboard Admin reviewer all-group scope v1",
);
