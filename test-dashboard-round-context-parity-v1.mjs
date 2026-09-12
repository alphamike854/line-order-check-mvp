import assert from "node:assert/strict";

import {
  buildCurrentRoundScope,
  loadDashboardRoundContext,
  selectCurrentSummaryGroupRounds,
} from "./src/lib/dashboard-round-context.mjs";


function normalizeComparable(
  value,
) {
  if (value == null) {
    return value;
  }

  return String(value);
}


function createSupabaseMock({
  rows = [],
  error = null,
} = {}) {
  const calls = [];

  function createQuery(
    table,
  ) {
    const filters = [];

    const query = {
      select(columns) {
        calls.push({
          method: "select",
          table,
          columns,
        });

        return query;
      },

      eq(
        column,
        value,
      ) {
        calls.push({
          method: "eq",
          table,
          column,
          value,
        });

        filters.push({
          type: "eq",
          column,
          value,
        });

        return query;
      },

      in(
        column,
        values,
      ) {
        calls.push({
          method: "in",
          table,
          column,
          values: [
            ...values,
          ],
        });

        filters.push({
          type: "in",
          column,
          values: [
            ...values,
          ],
        });

        return query;
      },

      order(
        column,
        options = {},
      ) {
        calls.push({
          method: "order",
          table,
          column,
          options: {
            ...options,
          },
        });

        return query;
      },

      then(
        resolve,
        reject,
      ) {
        try {
          if (error) {
            return Promise.resolve(
              {
                data: null,
                error,
              },
            ).then(
              resolve,
              reject,
            );
          }

          const filtered =
            rows.filter(
              (row) => {
                for (
                  const filter
                  of filters
                ) {
                  const rowValue =
                    normalizeComparable(
                      row?.[
                        filter.column
                      ],
                    );

                  if (
                    filter.type
                    === "eq"
                  ) {
                    if (
                      rowValue
                      !== normalizeComparable(
                        filter.value,
                      )
                    ) {
                      return false;
                    }

                    continue;
                  }

                  if (
                    filter.type
                    === "in"
                  ) {
                    const allowed =
                      filter.values.map(
                        normalizeComparable,
                      );

                    if (
                      !allowed.includes(
                        rowValue,
                      )
                    ) {
                      return false;
                    }
                  }
                }

                return true;
              },
            );

          return Promise.resolve(
            {
              data:
                filtered.map(
                  (row) => ({
                    ...row,
                  }),
                ),

              error: null,
            },
          ).then(
            resolve,
            reject,
          );
        } catch (
          caught
        ) {
          return Promise.reject(
            caught,
          ).then(
            resolve,
            reject,
          );
        }
      },
    };

    return query;
  }


  const supabase = {
    from(table) {
      calls.push({
        method: "from",
        table,
      });

      return createQuery(
        table,
      );
    },
  };


  return {
    supabase,
    calls,
  };
}


const SESSION_ID =
  "10000000-0000-0000-0000-000000000001";


const rows = [
  {
    id: "N-7",
    settlement_session_id:
      SESSION_ID,
    summary_group_id:
      "NORTH",
    round_no: 7,
    business_date:
      "2026-09-10",
    daily_round_no: 1,
    status: "CLOSED",
    opened_at:
      "2026-09-10T01:00:00Z",
    closed_at:
      "2026-09-10T02:00:00Z",
    updated_at:
      "2026-09-10T02:00:00Z",
  },

  {
    id: "N-8",
    settlement_session_id:
      SESSION_ID,
    summary_group_id:
      "NORTH",
    round_no: 8,
    business_date:
      "2026-09-11",
    daily_round_no: 1,
    status: "CLOSED",
    opened_at:
      "2026-09-11T01:00:00Z",
    closed_at:
      "2026-09-11T02:00:00Z",
    updated_at:
      "2026-09-11T02:00:00Z",
  },

  {
    id: "S-3",
    settlement_session_id:
      SESSION_ID,
    summary_group_id:
      "SOUTH",
    round_no: 3,
    business_date:
      "2026-09-10",
    daily_round_no: 2,
    status: "OPEN",
    opened_at:
      "2026-09-10T10:00:00Z",
    closed_at: null,
    updated_at:
      "2026-09-10T10:00:00Z",
  },

  // Must not enter current operational scope.
  {
    id: "N-99-ARCHIVED",
    settlement_session_id:
      SESSION_ID,
    summary_group_id:
      "NORTH",
    round_no: 99,
    business_date:
      "2099-01-01",
    daily_round_no: 99,
    status: "ARCHIVED",
    opened_at:
      "2099-01-01T00:00:00Z",
    closed_at:
      "2099-01-01T01:00:00Z",
    updated_at:
      "2099-01-01T01:00:00Z",
  },

  // Another parent session must never leak.
  {
    id: "N-OTHER",
    settlement_session_id:
      "20000000-0000-0000-0000-000000000002",
    summary_group_id:
      "NORTH",
    round_no: 100,
    business_date:
      "2098-01-01",
    daily_round_no: 1,
    status: "OPEN",
    opened_at:
      "2098-01-01T00:00:00Z",
    closed_at: null,
    updated_at:
      "2098-01-01T00:00:00Z",
  },
];


// ------------------------------------------------------------
// C2-01: pure selector parity.
// ------------------------------------------------------------

assert.deepEqual(
  selectCurrentSummaryGroupRounds(
    rows,
  ).map(
    (row) =>
      row.id,
  ),
  [
    "N-OTHER",
    "S-3",
  ],
  "pure selector has no settlement-session input and therefore only resolves per-group latest from supplied rows",
);

console.log(
  "PASS DR1D-C2-01: pure selector behavior is explicit and deterministic",
);


// ------------------------------------------------------------
// C2-02: DB resolver must enforce parent settlement boundary.
// ------------------------------------------------------------

{
  const {
    supabase,
    calls,
  } =
    createSupabaseMock({
      rows,
    });

  const context =
    await loadDashboardRoundContext({
      supabase,
      settlementSessionId:
        SESSION_ID,
    });

  assert.deepEqual(
    context.roundIds,
    [
      "N-8",
      "S-3",
    ],
  );

  assert.deepEqual(
    context.businessDates,
    [
      "2026-09-10",
      "2026-09-11",
    ],
  );

  assert.equal(
    context.businessDate,
    null,
  );

  assert.ok(
    calls.some(
      (call) =>
        call.method === "eq"
        && call.column
          === "settlement_session_id"
        && call.value
          === SESSION_ID,
    ),
    "resolver must scope to parent compatibility settlement",
  );

  assert.ok(
    calls.some(
      (call) =>
        call.method === "in"
        && call.column
          === "status"
        && JSON.stringify(
          call.values,
        )
          === JSON.stringify([
            "OPEN",
            "CLOSED",
          ]),
    ),
    "resolver must exclude non-current lifecycle statuses",
  );

  console.log(
    "PASS DR1D-C2-02: ALL resolver enforces session boundary and latest Round per group",
  );
}


// ------------------------------------------------------------
// C2-03: ALL may span different Round business dates.
// ------------------------------------------------------------

{
  const {
    supabase,
  } =
    createSupabaseMock({
      rows,
    });

  const context =
    await loadDashboardRoundContext({
      supabase,
      settlementSessionId:
        SESSION_ID,
    });

  assert.equal(
    context.businessDate,
    null,
  );

  assert.deepEqual(
    context.businessDates,
    [
      "2026-09-10",
      "2026-09-11",
    ],
  );

  console.log(
    "PASS DR1D-C2-03: ALL exposes mixed Round dates without synthetic global date",
  );
}


// ------------------------------------------------------------
// C2-04: selected Summary Group resolves exactly one latest Round.
// ------------------------------------------------------------

{
  const {
    supabase,
    calls,
  } =
    createSupabaseMock({
      rows,
    });

  const context =
    await loadDashboardRoundContext({
      supabase,
      settlementSessionId:
        SESSION_ID,
      summaryGroupId:
        " north ",
    });

  assert.deepEqual(
    context.roundIds,
    [
      "N-8",
    ],
  );

  assert.equal(
    context.businessDate,
    "2026-09-11",
  );

  assert.deepEqual(
    context.businessDates,
    [
      "2026-09-11",
    ],
  );

  assert.ok(
    calls.some(
      (call) =>
        call.method === "eq"
        && call.column
          === "summary_group_id"
        && call.value
          === "NORTH",
    ),
    "selected group must be normalized before query scope",
  );

  console.log(
    "PASS DR1D-C2-04: SELECTED resolves normalized group + latest Round only",
  );
}


// ------------------------------------------------------------
// C2-05: latest CLOSED beats older CLOSED/OPEN by round_no.
// Status is lifecycle visibility, not preference.
// ------------------------------------------------------------

{
  const source = [
    {
      id: "X-1",
      summary_group_id:
        "NORTH",
      round_no: 1,
      business_date:
        "2026-09-10",
      status: "OPEN",
    },
    {
      id: "X-2",
      summary_group_id:
        "NORTH",
      round_no: 2,
      business_date:
        "2026-09-11",
      status: "CLOSED",
    },
  ];

  const scope =
    buildCurrentRoundScope(
      source,
      "NORTH",
    );

  assert.deepEqual(
    scope.roundIds,
    [
      "X-2",
    ],
  );

  assert.equal(
    scope.businessDate,
    "2026-09-11",
  );

  console.log(
    "PASS DR1D-C2-05: highest round_no is current regardless OPEN/CLOSED status",
  );
}


// ------------------------------------------------------------
// C2-06: no parent session => no DB query and empty active scope.
// ------------------------------------------------------------

{
  const {
    supabase,
    calls,
  } =
    createSupabaseMock({
      rows,
    });

  const context =
    await loadDashboardRoundContext({
      supabase,
      settlementSessionId:
        null,
      summaryGroupId:
        "NORTH",
    });

  assert.deepEqual(
    context.roundIds,
    [],
  );

  assert.deepEqual(
    context.businessDates,
    [],
  );

  assert.equal(
    context.businessDate,
    null,
  );

  assert.equal(
    calls.length,
    0,
  );

  console.log(
    "PASS DR1D-C2-06: no session returns empty scope without query",
  );
}


// ------------------------------------------------------------
// C2-07: no matching current Round is explicit empty state.
// ------------------------------------------------------------

{
  const {
    supabase,
  } =
    createSupabaseMock({
      rows,
    });

  const context =
    await loadDashboardRoundContext({
      supabase,
      settlementSessionId:
        SESSION_ID,
      summaryGroupId:
        "EAST",
    });

  assert.deepEqual(
    context.roundIds,
    [],
  );

  assert.deepEqual(
    context.rounds,
    [],
  );

  assert.equal(
    context.businessDate,
    null,
  );

  console.log(
    "PASS DR1D-C2-07: group without current Round fails empty, not cross-group",
  );
}


// ------------------------------------------------------------
// C2-08: DB/read error fails closed.
// ------------------------------------------------------------

{
  const expectedError =
    new Error(
      "ROUND_CONTEXT_READ_FAIL",
    );

  const {
    supabase,
  } =
    createSupabaseMock({
      rows,
      error:
        expectedError,
    });

  await assert.rejects(
    () =>
      loadDashboardRoundContext({
        supabase,
        settlementSessionId:
          SESSION_ID,
      }),
    (
      error,
    ) =>
      error
      === expectedError,
  );

  console.log(
    "PASS DR1D-C2-08: Round-context read errors fail closed",
  );
}


// ------------------------------------------------------------
// C2-09: resolver asks for both identity and date metadata.
// ------------------------------------------------------------

{
  const {
    supabase,
    calls,
  } =
    createSupabaseMock({
      rows,
    });

  await loadDashboardRoundContext({
    supabase,
    settlementSessionId:
      SESSION_ID,
  });

  const selectCall =
    calls.find(
      (call) =>
        call.method
        === "select",
    );

  assert.ok(
    selectCall,
    "Round resolver must select explicit projection",
  );

  for (
    const field
    of [
      "id",
      "summary_group_id",
      "round_no",
      "business_date",
      "daily_round_no",
      "status",
      "opened_at",
      "closed_at",
    ]
  ) {
    assert.ok(
      selectCall.columns.includes(
        field,
      ),
      `Round projection missing ${field}`,
    );
  }

  console.log(
    "PASS DR1D-C2-09: resolver projection carries complete current-Round identity",
  );
}


// ------------------------------------------------------------
// C2-10: resolver requests deterministic ordering.
// ------------------------------------------------------------

{
  const {
    supabase,
    calls,
  } =
    createSupabaseMock({
      rows,
    });

  await loadDashboardRoundContext({
    supabase,
    settlementSessionId:
      SESSION_ID,
  });

  const orderCalls =
    calls.filter(
      (call) =>
        call.method
        === "order",
    );

  assert.deepEqual(
    orderCalls.map(
      (call) => [
        call.column,
        call.options
          ?.ascending,
      ],
    ),
    [
      [
        "summary_group_id",
        true,
      ],
      [
        "round_no",
        false,
      ],
    ],
  );

  console.log(
    "PASS DR1D-C2-10: resolver query ordering is deterministic",
  );
}


console.log(
  "PASS: DR1D-C2 CURRENT-ROUND READ-MODEL MOCK PARITY",
);
