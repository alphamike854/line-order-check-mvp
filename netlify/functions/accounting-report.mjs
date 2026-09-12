import {
  json,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  loadDashboardRoundContext,
} from "../../src/lib/dashboard-round-context.mjs";

import {
  reducedQuantity,
  reconciliationTotal,
} from "../../src/lib/settlement-calculations.mjs";

import {
  effectiveMultiplier,
  round2,
} from "../../src/lib/risk-engine.mjs";

import {
  firstLedgerCode,
} from "../../src/lib/report-ledger.mjs";


const REPORT_PAGE_SIZE = 500;


async function fetchAllPages(makeQuery) {
  const rows = [];

  for (
    let from = 0;
    ;
    from += REPORT_PAGE_SIZE
  ) {
    const { data, error } =
      await makeQuery().range(
        from,
        from + REPORT_PAGE_SIZE - 1,
      );

    if (error) throw error;

    const page = data ?? [];

    rows.push(...page);

    if (page.length < REPORT_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}


async function resolveSession(url) {
  const explicit =
    url.searchParams.get(
      "session_id",
    );

  if (explicit) {
    const { data, error } =
      await supabase
        .from("settlement_sessions")
        .select(
          "id,business_date,status,opened_at,closed_at",
        )
        .eq(
          "id",
          explicit,
        )
        .single();

    if (error) throw error;

    return data;
  }

  const { data, error } =
    await supabase
      .from("settlement_sessions")
      .select(
        "id,business_date,status,opened_at,closed_at",
      )
      .eq(
        "status",
        "OPEN",
      )
      .maybeSingle();

  if (error) throw error;

  return data;
}


function normalizeSummaryGroup(
  value,
) {
  const normalized =
    String(
      value ?? "",
    )
      .trim()
      .toUpperCase();

  if (
    !normalized
    || normalized === "ALL"
  ) {
    return null;
  }

  return normalized;
}


function roundContextSignature(
  rounds,
) {
  return (rounds ?? [])
    .map(
      (round) => [
        round.summary_group_id,
        round.id,
        round.round_no,
        round.business_date,
        round.daily_round_no,
        round.status,
        round.updated_at ?? "",
      ].join("|"),
    )
    .sort()
    .join("||");
}


async function revalidateRoundContext({
  initialContext,
  settlementSessionId,
  summaryGroupId,
}) {
  const current =
    await loadDashboardRoundContext({
      supabase,
      settlementSessionId,
      summaryGroupId:
        summaryGroupId ?? null,
    });

  if (
    roundContextSignature(
      current.rounds,
    )
    !== roundContextSignature(
      initialContext.rounds,
    )
  ) {
    const error =
      new Error(
        "ACCOUNTING_ROUND_CONTEXT_CHANGED",
      );

    error.status = 409;

    throw error;
  }

  return current;
}


function normalizePointContext(
  value,
) {
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
  ) {
    return value;
  }

  if (
    Array.isArray(value)
    && value.length === 1
    && value[0]
    && typeof value[0] === "object"
  ) {
    if (
      Array.isArray(
        value[0].rounds,
      )
    ) {
      return value[0];
    }

    const candidate =
      Object.values(
        value[0],
      )[0];

    if (
      candidate
      && typeof candidate === "object"
      && !Array.isArray(candidate)
    ) {
      return candidate;
    }
  }

  return {};
}


function promotionAppliesToLineGroup(
  promotion,
  lineGroupId,
) {
  if (
    promotion?.target_scope
    !== "SELECTED"
  ) {
    return true;
  }

  return (
    promotion.line_group_ids
    ?? []
  ).includes(
    lineGroupId,
  );
}


function isRoundConflict(
  error,
) {
  const message =
    String(
      error?.message
      ?? error
      ?? "",
    );

  return (
    error?.status === 409
    || message.includes(
      "ACCOUNTING_ROUND_CONTEXT_CHANGED",
    )
    || message.includes(
      "ACCOUNTING_ROUND_NOT_CURRENT",
    )
    || message.includes(
      "ACCOUNTING_ROUND_ARCHIVED",
    )
    || message.includes(
      "ACCOUNTING_ROUND_SCOPE_INVALID",
    )
  );
}


function responseContext(
  session,
  roundContext,
) {
  return {
    session,

    // Compatibility settlement remains selectable/history metadata.
    // Active Accounting date/status authority is Round identity below.
    business_date:
      roundContext.businessDate,

    business_dates:
      roundContext.businessDates,

    current_rounds:
      roundContext.rounds,
  };
}


export default async (req) => {
  if (
    req.method !== "GET"
  ) {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
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
    const url =
      new URL(req.url);

    const session =
      await resolveSession(url);

    if (!session) {
      return json({
        ok: true,
        session: null,
        business_date: null,
        business_dates: [],
        current_rounds: [],
        groups: [],
      });
    }


    const selectedSummary =
      normalizeSummaryGroup(
        url.searchParams.get(
          "group",
        ),
      );

    const selectedLineRaw =
      String(
        url.searchParams.get(
          "line_group",
        )
        ?? "",
      ).trim();

    const selectedLine =
      selectedLineRaw
      && selectedLineRaw !== "ALL"
        ? selectedLineRaw
        : null;

    const summaryOnly =
      url.searchParams.get(
        "summary_only",
      ) === "1"
      && !selectedLine;


    let configQuery =
      supabase
        .from(
          "settlement_line_group_config",
        )
        .select(
          "line_group_id,line_group_name,summary_group_id,reduction_pct",
        )
        .eq(
          "settlement_session_id",
          session.id,
        )
        .order(
          "line_group_name",
        );

    if (selectedSummary) {
      configQuery =
        configQuery.eq(
          "summary_group_id",
          selectedSummary,
        );
    }

    if (selectedLine) {
      configQuery =
        configQuery.eq(
          "line_group_id",
          selectedLine,
        );
    }


    const {
      data: configRows,
      error: configError,
    } = await configQuery;

    if (configError) {
      throw configError;
    }


    const configuredSummaryIds =
      [
        ...new Set(
          (configRows ?? [])
            .map(
              (row) =>
                row.summary_group_id,
            )
            .filter(Boolean),
        ),
      ];


    if (
      configuredSummaryIds.length === 0
    ) {
      return json({
        ok: true,
        summary_only:
          summaryOnly,

        session,

        business_date: null,
        business_dates: [],
        current_rounds: [],

        actual_point_status:
          null,

        actual_point_statuses:
          [],

        point_profiles:
          [],

        promotions:
          [],

        actual_special_codes:
          [],

        groups: [],
      });
    }


    // A one-group report should not be invalidated by an unrelated
    // Summary Group changing Round during the request.
    const roundScopeSummaryGroup =
      configuredSummaryIds.length === 1
        ? configuredSummaryIds[0]
        : null;


    const roundContext =
      await loadDashboardRoundContext({
        supabase,
        settlementSessionId:
          session.id,
        summaryGroupId:
          roundScopeSummaryGroup,
      });


    const roundIds =
      roundContext.roundIds;


    if (
      roundIds.length === 0
    ) {
      await revalidateRoundContext({
        initialContext:
          roundContext,
        settlementSessionId:
          session.id,
        summaryGroupId:
          roundScopeSummaryGroup,
      });

      return json({
        ok: true,
        summary_only:
          summaryOnly,

        ...responseContext(
          session,
          roundContext,
        ),

        actual_point_status:
          null,

        actual_point_statuses:
          [],

        point_profiles:
          [],

        promotions:
          [],

        actual_special_codes:
          [],

        groups: [],
      });
    }


    const roundMap =
      new Map(
        roundContext.rounds.map(
          (round) => [
            round.summary_group_id,
            round,
          ],
        ),
      );


    const configs =
      (configRows ?? [])
        .filter(
          (row) =>
            roundMap.has(
              row.summary_group_id,
            ),
        );


    const [
      pointContextResult,
      pointStatusResult,
    ] = await Promise.all([
      supabase.rpc(
        "accounting_round_point_context",
        {
          p_session_id:
            session.id,
          p_round_ids:
            roundIds,
        },
      ),

      supabase.rpc(
        "accounting_round_point_status",
        {
          p_session_id:
            session.id,
          p_round_ids:
            roundIds,
        },
      ),
    ]);


    if (
      pointContextResult.error
    ) {
      throw pointContextResult.error;
    }

    if (
      pointStatusResult.error
    ) {
      throw pointStatusResult.error;
    }


    const pointContext =
      normalizePointContext(
        pointContextResult.data,
      );


    const profiles =
      pointContext.point_profiles
      ?? [];

    const promotions =
      pointContext.promotions
      ?? [];

    const actualCodes =
      pointContext.actual_special_point_codes
      ?? [];

    const statusRows =
      pointStatusResult.data
      ?? [];


    const relevantSummaryIds =
      new Set(
        configs.map(
          (row) =>
            row.summary_group_id,
        ),
      );


    const relevantPromotions =
      promotions.filter(
        (row) =>
          relevantSummaryIds.has(
            row.summary_group_id,
          ),
      );

    const relevantActualCodes =
      actualCodes.filter(
        (row) =>
          relevantSummaryIds.has(
            row.summary_group_id,
          ),
      );

    const relevantStatusRows =
      statusRows.filter(
        (row) =>
          relevantSummaryIds.has(
            row.summary_group_id,
          ),
      );


    const statusMap =
      new Map(
        relevantStatusRows.map(
          (row) => [
            row.summary_group_id,
            row,
          ],
        ),
      );


    const profileMap =
      new Map(
        profiles.map(
          (row) => [
            row.category,
            Number(
              row.special_multiplier,
            ),
          ],
        ),
      );


    const promotionMap =
      new Map();

    for (
      const promotion
      of relevantPromotions
    ) {
      const key =
        [
          promotion.summary_group_id,
          promotion.category,
          promotion.code,
        ].join("|");

      if (
        !promotionMap.has(key)
      ) {
        promotionMap.set(
          key,
          [],
        );
      }

      promotionMap
        .get(key)
        .push(
          promotion,
        );
    }


    const actualSet =
      new Set(
        relevantActualCodes.map(
          (row) =>
            [
              row.summary_group_id,
              row.category,
              row.code,
            ].join("|"),
        ),
      );


    const readySummaryGroupCount =
      [
        ...relevantSummaryIds,
      ].filter(
        (id) =>
          statusMap.get(id)
            ?.actual_codes_ready
          === true,
      ).length;


    const aggregateStatus =
      relevantSummaryIds.size
        ? {
          actual_codes_ready:
            readySummaryGroupCount
            === relevantSummaryIds.size,

          summary_group_count:
            relevantSummaryIds.size,

          ready_summary_group_count:
            readySummaryGroupCount,
        }
        : null;


    const lineIds =
      configs.map(
        (row) =>
          row.line_group_id,
      );


    if (
      lineIds.length === 0
    ) {
      await revalidateRoundContext({
        initialContext:
          roundContext,
        settlementSessionId:
          session.id,
        summaryGroupId:
          roundScopeSummaryGroup,
      });

      return json({
        ok: true,
        summary_only:
          summaryOnly,

        ...responseContext(
          session,
          roundContext,
        ),

        actual_point_status:
          aggregateStatus,

        actual_point_statuses:
          relevantStatusRows,

        point_profiles:
          profiles,

        promotions:
          relevantPromotions,

        actual_special_codes:
          relevantActualCodes,

        groups: [],
      });
    }


    if (summaryOnly) {
      const {
        data: summaryRows,
        error: summaryError,
      } = await supabase.rpc(
        "accounting_report_line_group_summary_rounds",
        {
          p_session_id:
            session.id,

          p_round_ids:
            roundIds,

          p_summary_group_id:
            selectedSummary,
        },
      );

      if (summaryError) {
        throw summaryError;
      }


      const allowedLineIds =
        new Set(
          lineIds,
        );


      const groups =
        (summaryRows ?? [])
          .filter(
            (row) =>
              allowedLineIds.has(
                row.line_group_id,
              ),
          )
          .map(
            (row) => ({
              line_group_id:
                row.line_group_id,

              line_group_name:
                row.line_group_name,

              summary_group_id:
                row.summary_group_id,

              round_id:
                row.round_id,

              business_date:
                row.business_date,

              daily_round_no:
                Number(
                  row.daily_round_no
                  ?? 0,
                ),

              round_no:
                Number(
                  row.round_no
                  ?? 0,
                ),

              round_status:
                row.round_status,

              reduction_pct:
                Number(
                  row.reduction_pct
                  || 0,
                ),

              point_specified:
                relevantActualCodes
                  .some(
                    (actual) =>
                      actual.summary_group_id
                        === row.summary_group_id
                      && String(
                        actual.round_id,
                      )
                        === String(
                          row.round_id,
                        ),
                  ),

              actual_point_status:
                statusMap.get(
                  row.summary_group_id,
                )
                ?? null,

              received_total:
                Number(
                  row.received_total
                  || 0,
                ),

              after_reduction:
                Number(
                  row.after_reduction
                  || 0,
                ),

              reduction_amount:
                Number(
                  row.reduction_amount
                  || 0,
                ),

              special_point_total:
                Number(
                  row.special_point_total
                  || 0,
                ),

              reconciliation_total:
                Number(
                  row.reconciliation_total
                  || 0,
                ),

              message_count:
                Number(
                  row.message_count
                  || 0,
                ),

              special_point_codes:
                [],

              ledger:
                [],
            }),
          );


      await revalidateRoundContext({
        initialContext:
          roundContext,
        settlementSessionId:
          session.id,
        summaryGroupId:
          roundScopeSummaryGroup,
      });


      return json({
        ok: true,
        summary_only: true,

        ...responseContext(
          session,
          roundContext,
        ),

        actual_point_status:
          aggregateStatus,

        actual_point_statuses:
          relevantStatusRows,

        point_profiles:
          profiles,

        promotions:
          relevantPromotions,

        actual_special_codes:
          relevantActualCodes,

        groups,
      });
    }


    const [messages,items] =
      await Promise.all([
        fetchAllPages(
          () =>
            supabase
              .rpc(
                "accounting_effective_order_messages_rounds",
                {
                  p_session_id:
                    session.id,

                  p_round_ids:
                    roundIds,

                  p_line_group_ids:
                    lineIds,
                },
              )
              .select(
                "id,line_group_id,event_timestamp,raw_text,normalized_text,ocr_text,first_order_code,message_truth_source",
              )
              .order(
                "event_timestamp",
                {
                  ascending: true,
                },
              )
              .order(
                "id",
                {
                  ascending: true,
                },
              ),
        ),

        fetchAllPages(
          () =>
            supabase
              .rpc(
                "accounting_effective_order_items_rounds",
                {
                  p_session_id:
                    session.id,

                  p_round_ids:
                    roundIds,

                  p_line_group_ids:
                    lineIds,
                },
              )
              .order(
                "message_record_id",
                {
                  ascending: true,
                },
              )
              .order(
                "category",
                {
                  ascending: true,
                },
              )
              .order(
                "code",
                {
                  ascending: true,
                },
              ),
        ),
      ]);


    const itemsByMessage =
      new Map();

    for (
      const item
      of items ?? []
    ) {
      if (
        !itemsByMessage.has(
          item.message_record_id,
        )
      ) {
        itemsByMessage.set(
          item.message_record_id,
          [],
        );
      }

      itemsByMessage
        .get(
          item.message_record_id,
        )
        .push(item);
    }


    const groups =
      configs.map(
        (cfg) => {
          const round =
            roundMap.get(
              cfg.summary_group_id,
            );


          const groupMessages =
            (messages ?? [])
              .filter(
                (message) =>
                  message.line_group_id
                    === cfg.line_group_id
                  && itemsByMessage.has(
                    message.id,
                  ),
              );


          let received = 0;
          let special = 0;

          const specialCodeMap =
            new Map();


          const ledger =
            groupMessages.map(
              (
                message,
                index,
              ) => {
                const msgItems =
                  itemsByMessage.get(
                    message.id,
                  )
                  ?? [];


                const qty =
                  msgItems.reduce(
                    (
                      sum,
                      item,
                    ) =>
                      sum
                      + Number(
                        item.quantity,
                      ),
                    0,
                  );

                received += qty;


                const specialDetails =
                  [];


                for (
                  const item
                  of msgItems
                ) {
                  const key =
                    `${item.category}|${item.code}`;

                  const scopedKey =
                    `${cfg.summary_group_id}|${key}`;


                  if (
                    !actualSet.has(
                      scopedKey,
                    )
                  ) {
                    continue;
                  }


                  const base =
                    profileMap.get(
                      item.category,
                    )
                    ?? 0;


                  const applicablePromotion =
                    (
                      promotionMap.get(
                        scopedKey,
                      )
                      ?? []
                    ).find(
                      (promotion) =>
                        promotionAppliesToLineGroup(
                          promotion,
                          cfg.line_group_id,
                        ),
                    );


                  const factor =
                    Number(
                      applicablePromotion
                        ?.point_factor_pct
                      ?? 100,
                    );


                  const multiplier =
                    effectiveMultiplier(
                      base,
                      factor,
                    );


                  const points =
                    round2(
                      Number(
                        item.quantity,
                      )
                      * multiplier,
                    );


                  special += points;


                  const previous =
                    specialCodeMap.get(
                      key,
                    )
                    ?? {
                      category:
                        item.category,

                      code:
                        item.code,

                      quantity: 0,

                      multiplier,

                      promotion_factor_pct:
                        factor,

                      points: 0,
                    };


                  previous.quantity +=
                    Number(
                      item.quantity,
                    );

                  previous.points =
                    round2(
                      previous.points
                      + points,
                    );


                  specialCodeMap.set(
                    key,
                    previous,
                  );


                  specialDetails.push({
                    category:
                      item.category,

                    code:
                      item.code,

                    quantity:
                      Number(
                        item.quantity,
                      ),

                    multiplier,

                    promotion_factor_pct:
                      factor,

                    points,

                    truth_source:
                      item.truth_source
                      ?? null,
                  });
                }


                const sourceText =
                  message.raw_text
                  ?? message.ocr_text
                  ?? message.normalized_text
                  ?? "";


                const firstCode =
                  message.first_order_code
                  || firstLedgerCode(
                    msgItems,
                    sourceText,
                  )
                  || "";


                return {
                  sequence:
                    index + 1,

                  event_timestamp:
                    message.event_timestamp,

                  first_code:
                    firstCode,

                  summary_quantity:
                    qty,

                  has_special_point:
                    specialDetails.length
                    > 0,

                  special_points:
                    specialDetails,

                  message_truth_source:
                    message.message_truth_source
                    ?? null,

                  truth_sources:
                    [
                      ...new Set(
                        msgItems
                          .map(
                            (item) =>
                              item.truth_source,
                          )
                          .filter(Boolean),
                      ),
                    ],
                };
              },
            );


          special =
            round2(special);


          const afterReduction =
            reducedQuantity(
              received,
              cfg.reduction_pct,
            );


          const pointSpecified =
            relevantActualCodes.some(
              (actual) =>
                actual.summary_group_id
                  === cfg.summary_group_id
                && String(
                  actual.round_id,
                )
                  === String(
                    round?.id,
                  ),
            );


          const actualPointStatus =
            statusMap.get(
              cfg.summary_group_id,
            )
            ?? null;


          return {
            ...cfg,

            round_id:
              round?.id
              ?? null,

            business_date:
              round?.business_date
              ?? null,

            daily_round_no:
              Number(
                round?.daily_round_no
                ?? 0,
              ),

            round_no:
              Number(
                round?.round_no
                ?? 0,
              ),

            round_status:
              round?.status
              ?? null,

            point_specified:
              pointSpecified,

            actual_point_status:
              actualPointStatus,

            received_total:
              received,

            after_reduction:
              afterReduction,

            reduction_amount:
              round2(
                received
                - afterReduction,
              ),

            special_point_total:
              special,

            reconciliation_total:
              reconciliationTotal(
                received,
                cfg.reduction_pct,
                special,
              ),

            message_count:
              groupMessages.length,

            special_point_codes:
              [
                ...specialCodeMap
                  .values(),
              ].sort(
                (
                  a,
                  b,
                ) =>
                  a.category.localeCompare(
                    b.category,
                  )
                  || a.code.localeCompare(
                    b.code,
                  ),
              ),

            ledger,
          };
        },
      );


    await revalidateRoundContext({
      initialContext:
        roundContext,
      settlementSessionId:
        session.id,
      summaryGroupId:
        roundScopeSummaryGroup,
    });


    return json({
      ok: true,
      summary_only: false,

      ...responseContext(
        session,
        roundContext,
      ),

      actual_point_status:
        aggregateStatus,

      actual_point_statuses:
        relevantStatusRows,

      point_profiles:
        profiles,

      promotions:
        relevantPromotions,

      actual_special_codes:
        relevantActualCodes,

      groups,
    });

  } catch (error) {
    console.error(
      "accounting-report failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error?.message
          ?? String(error),
      },
      isRoundConflict(error)
        ? 409
        : 500,
    );
  }
};


export const config = {
  path:
    "/api/accounting-report",
};
