function normalizeSummaryGroupId(value) {
  const normalized =
    String(value ?? "")
      .trim()
      .toUpperCase();

  return normalized || null;
}


export function selectCurrentSummaryGroupRounds(
  rows,
  summaryGroupId = null,
) {
  const selectedGroup =
    normalizeSummaryGroupId(
      summaryGroupId,
    );

  const currentByGroup =
    new Map();

  for (const row of rows ?? []) {
    const groupId =
      normalizeSummaryGroupId(
        row?.summary_group_id,
      );

    if (!groupId) {
      continue;
    }

    if (
      selectedGroup
      && groupId !== selectedGroup
    ) {
      continue;
    }

    if (
      row?.status !== "OPEN"
      && row?.status !== "CLOSED"
    ) {
      continue;
    }

    const current =
      currentByGroup.get(groupId);

    if (
      !current
      || Number(row?.round_no ?? 0)
        > Number(current?.round_no ?? 0)
    ) {
      currentByGroup.set(
        groupId,
        row,
      );
    }
  }

  return [
    ...currentByGroup.values(),
  ].sort(
    (left, right) =>
      String(
        left.summary_group_id,
      ).localeCompare(
        String(
          right.summary_group_id,
        ),
      ),
  );
}


export function buildCurrentRoundScope(
  rows,
  summaryGroupId = null,
) {
  const rounds =
    selectCurrentSummaryGroupRounds(
      rows,
      summaryGroupId,
    );

  const roundIds =
    rounds
      .map((round) =>
        String(round?.id ?? "").trim()
      )
      .filter(Boolean);

  const businessDates = [
    ...new Set(
      rounds
        .map((round) =>
          String(
            round?.business_date ?? "",
          ).trim()
        )
        .filter(Boolean),
    ),
  ].sort();

  return {
    rounds,
    roundIds,
    businessDates,

    // A single business_date remains useful only when the
    // selected current-Round set really has one date.
    //
    // ALL may legitimately contain NORTH=D and SOUTH=D+1.
    businessDate:
      businessDates.length === 1
        ? businessDates[0]
        : null,
  };
}


export async function loadDashboardRoundContext({
  supabase,
  settlementSessionId,
  summaryGroupId = null,
}) {
  if (!settlementSessionId) {
    return buildCurrentRoundScope(
      [],
      summaryGroupId,
    );
  }

  let query =
    supabase
      .from(
        "settlement_summary_group_rounds",
      )
      .select(
        [
          "id",
          "settlement_session_id",
          "summary_group_id",
          "round_no",
          "business_date",
          "daily_round_no",
          "status",
          "opened_at",
          "closed_at",
          "updated_at",
        ].join(","),
      )
      .eq(
        "settlement_session_id",
        settlementSessionId,
      )
      .in(
        "status",
        [
          "OPEN",
          "CLOSED",
        ],
      )
      .order(
        "summary_group_id",
        {
          ascending: true,
        },
      )
      .order(
        "round_no",
        {
          ascending: false,
        },
      );

  const normalizedGroup =
    normalizeSummaryGroupId(
      summaryGroupId,
    );

  if (normalizedGroup) {
    query =
      query.eq(
        "summary_group_id",
        normalizedGroup,
      );
  }

  const {
    data,
    error,
  } = await query;

  if (error) {
    throw error;
  }

  return buildCurrentRoundScope(
    data ?? [],
    normalizedGroup,
  );
}


export function sameDashboardRoundScope(
  left,
  right,
) {
  const normalize = (scope) =>
    [
      ...new Set(
        (scope?.roundIds ?? [])
          .map(
            (roundId) =>
              String(
                roundId ?? "",
              ).trim(),
          )
          .filter(Boolean),
      ),
    ].sort();

  const leftIds =
    normalize(left);

  const rightIds =
    normalize(right);

  if (
    leftIds.length
    !== rightIds.length
  ) {
    return false;
  }

  return leftIds.every(
    (roundId, index) =>
      roundId
      === rightIds[index],
  );
}
