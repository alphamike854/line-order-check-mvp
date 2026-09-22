const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


export function normalizeExportSentRequest(
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


  /*
   * SENT accepts identity only.
   *
   * Quantity and destination were fixed earlier.
   * The browser cannot change them at this boundary.
   */
  return {
    round_id:
      roundId,

    cycle_id:
      cycleId,
  };
}
