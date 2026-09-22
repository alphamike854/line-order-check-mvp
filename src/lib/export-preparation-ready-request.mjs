const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeExportReadyRequest(
  body,
) {
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
  ) {
    throw new Error(
      "INVALID_REQUEST_BODY",
    );
  }

  const roundId =
    String(
      body.round_id ?? "",
    ).trim();

  const cycleId =
    String(
      body.cycle_id ?? "",
    ).trim();

  const destinationLineGroupId =
    String(
      body.destination_line_group_id
      ?? "",
    ).trim();

  const destinationLabelRaw =
    body.destination_label;

  const destinationLabel =
    destinationLabelRaw === null
    || destinationLabelRaw === undefined
      ? null
      : String(
          destinationLabelRaw,
        ).trim() || null;

  if (!UUID_RE.test(roundId)) {
    throw new Error(
      "INVALID_ROUND_ID",
    );
  }

  if (!UUID_RE.test(cycleId)) {
    throw new Error(
      "INVALID_CYCLE_ID",
    );
  }

  if (
    !destinationLineGroupId
    || destinationLineGroupId.length > 255
  ) {
    throw new Error(
      "INVALID_DESTINATION_LINE_GROUP_ID",
    );
  }

  if (
    destinationLabel !== null
    && destinationLabel.length > 255
  ) {
    throw new Error(
      "INVALID_DESTINATION_LABEL",
    );
  }

  return {
    round_id:
      roundId,

    cycle_id:
      cycleId,

    destination_line_group_id:
      destinationLineGroupId,

    destination_label:
      destinationLabel,
  };
}
