function filterSummaryGroup(
  rows,
  summaryGroupId,
) {
  if (!summaryGroupId) {
    return rows ?? [];
  }

  return (rows ?? []).filter(
    (row) =>
      row.summary_group_id
      === summaryGroupId,
  );
}


function sortLineGroupIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => String(item))
        .filter(Boolean),
    ),
  ].sort();
}


function sortPromotions(rows) {
  return [...rows].sort(
    (a,b) =>
      String(a.summary_group_id)
        .localeCompare(
          String(b.summary_group_id),
        )
      || String(a.category)
        .localeCompare(
          String(b.category),
        )
      || String(a.code)
        .localeCompare(
          String(b.code),
        ),
  );
}


function sortActual(rows) {
  return [...rows].sort(
    (a,b) =>
      String(a.summary_group_id)
        .localeCompare(
          String(b.summary_group_id),
        )
      || String(a.category)
        .localeCompare(
          String(b.category),
        )
      || String(a.code)
        .localeCompare(
          String(b.code),
        ),
  );
}


export function mergeRoundAwarePointMetadata({
  rounds = [],
  currentPromotions = [],
  legacyPromotions = [],
  currentActual = [],
  legacyActual = [],
  summaryGroupId = "",
}) {
  const scopedRounds=
    filterSummaryGroup(
      rounds,
      summaryGroupId,
    );

  const roundByGroup=
    new Map(
      scopedRounds.map(
        (round) => [
          round.summary_group_id,
          round,
        ],
      ),
    );

  const promotions=[];

  for(
    const row of filterSummaryGroup(
      currentPromotions,
      summaryGroupId,
    )
  ){
    const round=
      roundByGroup.get(
        row.summary_group_id
      );

    if (!round) {
      continue;
    }

    if (
      String(row.round_id)
      !== String(round.id)
    ) {
      throw new Error(
        "CURRENT_ROUND_PROMOTION_PROJECTION_MISMATCH"
      );
    }

    promotions.push({
      ...row,
      target_scope:
        row.target_scope === "SELECTED"
          ? "SELECTED"
          : "ALL",
      line_group_ids:
        sortLineGroupIds(
          row.line_group_ids
        ),
    });
  }

  for(
    const row of filterSummaryGroup(
      legacyPromotions,
      summaryGroupId,
    )
  ){
    if(
      roundByGroup.has(
        row.summary_group_id
      )
    ){
      continue;
    }

    promotions.push({
      ...row,
      round_id:null,
      round_no:null,
      round_status:null,
      promotion_id:null,
      target_scope:"ALL",
      line_group_ids:[],
      updated_at:null,
      updated_by:null,
    });
  }

  const actual=[];

  for(
    const row of filterSummaryGroup(
      currentActual,
      summaryGroupId,
    )
  ){
    const round=
      roundByGroup.get(
        row.summary_group_id
      );

    if (!round) {
      continue;
    }

    if (
      String(row.round_id)
      !== String(round.id)
    ) {
      throw new Error(
        "CURRENT_ROUND_ACTUAL_PROJECTION_MISMATCH"
      );
    }

    actual.push(row);
  }

  for(
    const row of filterSummaryGroup(
      legacyActual,
      summaryGroupId,
    )
  ){
    if(
      roundByGroup.has(
        row.summary_group_id
      )
    ){
      continue;
    }

    actual.push({
      ...row,
      round_id:null,
      round_no:null,
      round_status:null,
      updated_at:
        row.updated_at
        ?? row.created_at
        ?? null,
      updated_by:null,
    });
  }

  return {
    rounds:[...scopedRounds].sort(
      (a,b) =>
        String(a.summary_group_id)
          .localeCompare(
            String(b.summary_group_id),
          )
        || Number(a.round_no||0)
          - Number(b.round_no||0),
    ),
    promotions:
      sortPromotions(promotions),
    actual:
      sortActual(actual),
  };
}


function latestRounds(rows) {
  const byGroup=new Map();

  for(const row of rows ?? []){
    const current=
      byGroup.get(
        row.summary_group_id
      );

    if(
      !current
      || Number(row.round_no)
        > Number(current.round_no)
    ){
      byGroup.set(
        row.summary_group_id,
        row,
      );
    }
  }

  return [...byGroup.values()];
}


function applySummaryGroup(
  query,
  summaryGroupId,
) {
  if (!summaryGroupId) {
    return query;
  }

  return query.eq(
    "summary_group_id",
    summaryGroupId,
  );
}


export async function loadDashboardPointContext({
  supabase,
  settlementSessionId,
  summaryGroupId = "",
}) {
  let roundsQuery=supabase
    .from(
      "settlement_summary_group_rounds"
    )
    .select(
      "id,summary_group_id,round_no,status,updated_at"
    )
    .eq(
      "settlement_session_id",
      settlementSessionId
    );

  let currentPromotionQuery=supabase
    .from(
      "settlement_summary_group_point_promotions_current"
    )
    .select(
      "summary_group_id,round_id,round_no,round_status,"
      + "promotion_id,category,code,point_factor_pct,"
      + "target_scope,line_group_ids,updated_at,updated_by"
    )
    .eq(
      "settlement_session_id",
      settlementSessionId
    );

  let legacyPromotionQuery=supabase
    .from("settlement_point_promotions")
    .select(
      "summary_group_id,category,code,point_factor_pct"
    )
    .eq(
      "settlement_session_id",
      settlementSessionId
    );

  let currentActualQuery=supabase
    .from(
      "settlement_summary_group_actual_special_point_codes_current"
    )
    .select(
      "summary_group_id,round_id,round_no,round_status,"
      + "category,code,created_at,updated_at,updated_by"
    )
    .eq(
      "settlement_session_id",
      settlementSessionId
    );

  let legacyActualQuery=supabase
    .from(
      "settlement_summary_group_actual_special_point_codes"
    )
    .select(
      "summary_group_id,category,code,created_at"
    )
    .eq(
      "settlement_session_id",
      settlementSessionId
    );

  roundsQuery=
    applySummaryGroup(
      roundsQuery,
      summaryGroupId,
    );

  currentPromotionQuery=
    applySummaryGroup(
      currentPromotionQuery,
      summaryGroupId,
    );

  legacyPromotionQuery=
    applySummaryGroup(
      legacyPromotionQuery,
      summaryGroupId,
    );

  currentActualQuery=
    applySummaryGroup(
      currentActualQuery,
      summaryGroupId,
    );

  legacyActualQuery=
    applySummaryGroup(
      legacyActualQuery,
      summaryGroupId,
    );

  const [
    roundsResult,
    currentPromotionResult,
    legacyPromotionResult,
    currentActualResult,
    legacyActualResult,
  ]=await Promise.all([
    roundsQuery,
    currentPromotionQuery,
    legacyPromotionQuery,
    currentActualQuery,
    legacyActualQuery,
  ]);

  for(
    const result of [
      roundsResult,
      currentPromotionResult,
      legacyPromotionResult,
      currentActualResult,
      legacyActualResult,
    ]
  ){
    if(result.error){
      throw result.error;
    }
  }

  const rounds=
    latestRounds(
      roundsResult.data??[]
    );

  const latestIds=
    rounds.map(
      (round) => round.id
    );

  let snapshots=[];

  if(latestIds.length>0){
    const snapshotResult=
      await supabase
        .from(
          "settlement_summary_group_round_snapshots"
        )
        .select("round_id")
        .in(
          "round_id",
          latestIds
        );

    if(snapshotResult.error){
      throw snapshotResult.error;
    }

    snapshots=
      snapshotResult.data??[];
  }

  const archived=
    new Set(
      snapshots.map(
        (row) =>
          String(row.round_id)
      ),
    );

  for(const round of rounds){
    if(
      archived.has(
        String(round.id)
      )
    ){
      throw new Error(
        "CURRENT_ROUND_ARCHIVED"
      );
    }

    if(
      round.status !== "OPEN"
      && round.status !== "CLOSED"
    ){
      throw new Error(
        "CURRENT_ROUND_INVALID_STATUS"
      );
    }
  }

  const normalizedRounds=
    rounds.map(
      (round) => ({
        ...round,
        round_id:round.id,
        round_status:round.status,
      }),
    );

  return mergeRoundAwarePointMetadata({
    rounds:normalizedRounds,
    currentPromotions:
      currentPromotionResult.data??[],
    legacyPromotions:
      legacyPromotionResult.data??[],
    currentActual:
      currentActualResult.data??[],
    legacyActual:
      legacyActualResult.data??[],
    summaryGroupId,
  });
}


function promotionSignature(rows) {
  return sortPromotions(rows ?? [])
    .map((row) => {
      const targets=
        sortLineGroupIds(
          row.line_group_ids
        ).join("+");

      return [
        row.summary_group_id,
        row.round_id??"LEGACY",
        `${row.category}${row.code}`,
        row.point_factor_pct,
        row.target_scope??"ALL",
        targets,
      ].join(":");
    })
    .join(",");
}


function actualSignature(rows) {
  return sortActual(rows ?? [])
    .map(
      (row) =>
        [
          row.summary_group_id,
          row.round_id??"LEGACY",
          `${row.category}${row.code}`,
        ].join(":"),
    )
    .join(",");
}


function roundSignature(rows) {
  return [...(rows ?? [])]
    .sort(
      (a,b) =>
        String(a.summary_group_id)
          .localeCompare(
            String(b.summary_group_id),
          ),
    )
    .map(
      (row) =>
        [
          row.summary_group_id,
          row.round_id??row.id,
          row.round_no,
          row.round_status??row.status,
        ].join(":"),
    )
    .join(",");
}


function settingsSignature({
  warehouseLimits,
  riskBudgets,
}) {
  const warehouse=
    [...(warehouseLimits??[])]
      .sort(
        (a,b) =>
          String(a.destination)
            .localeCompare(
              String(b.destination),
            ),
      )
      .map(
        (row) =>
          [
            row.destination,
            row.max_batch_quantity,
            row.updated_at,
          ].join(":"),
      );

  const risk=
    [...(riskBudgets??[])]
      .sort(
        (a,b) =>
          String(a.summary_group_id)
            .localeCompare(
              String(b.summary_group_id),
            )
          || String(a.risk_pool)
            .localeCompare(
              String(b.risk_pool),
            ),
      )
      .map(
        (row) =>
          [
            row.summary_group_id,
            row.risk_pool,
            row.point_loss_tolerance,
            row.updated_at,
          ].join(":"),
      );

  return [
    ...warehouse,
    ...risk,
  ].join(",");
}


export function buildDashboardFreshness({
  sessionId,
  messageAt = null,
  transferAt = null,
  settingsAt = null,
  rounds = [],
  actualCodes = [],
  promotions = [],
  warehouseLimits = [],
  riskBudgets = [],
}) {
  const roundsSignature=
    roundSignature(rounds);

  const pointsSignature=
    actualSignature(actualCodes);

  const promotionsSignature=
    promotionSignature(promotions);

  const configSignature=
    settingsSignature({
      warehouseLimits,
      riskBudgets,
    });

  const freshness={
    message_at:messageAt,
    transfer_at:transferAt,
    rounds_signature:
      roundsSignature,
    points_signature:
      pointsSignature,
    promotions_signature:
      promotionsSignature,
    settings_signature:
      configSignature,
    settings_at:settingsAt,
  };

  freshness.version=[
    sessionId,
    messageAt??"",
    transferAt??"",
    roundsSignature,
    pointsSignature,
    promotionsSignature,
    configSignature,
    settingsAt??"",
  ].join("|");

  return freshness;
}
