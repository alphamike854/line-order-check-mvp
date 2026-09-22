const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_CATEGORIES =
  new Set([
    "A",
    "B",
    "E",
    "F",
    "G",
    "H",
    "L",
  ]);

export function normalizeExportDraftRequest(
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

  if (!UUID_RE.test(roundId)) {
    throw new Error(
      "INVALID_ROUND_ID",
    );
  }

  const clientRequestId =
    String(
      body.client_request_id ?? "",
    ).trim();

  if (
    !UUID_RE.test(
      clientRequestId,
    )
  ) {
    throw new Error(
      "INVALID_CLIENT_REQUEST_ID",
    );
  }

  if (
    !Array.isArray(body.items)
    || body.items.length < 1
    || body.items.length > 200
  ) {
    throw new Error(
      "INVALID_EXPORT_ITEMS",
    );
  }

  const seen =
    new Set();

  const items =
    body.items.map(
      (item) => {
        if (
          !item
          || typeof item !== "object"
          || Array.isArray(item)
        ) {
          throw new Error(
            "INVALID_EXPORT_ITEM",
          );
        }

        const category =
          String(
            item.category ?? "",
          )
            .trim()
            .toUpperCase();

        const code =
          String(
            item.code ?? "",
          ).trim();

        const quantity =
          Number(
            item.selected_send_quantity,
          );

        if (
          !ALLOWED_CATEGORIES.has(
            category,
          )
        ) {
          throw new Error(
            "INVALID_EXPORT_CATEGORY",
          );
        }

        if (
          !/^[0-9]{1,3}$/.test(
            code,
          )
        ) {
          throw new Error(
            "INVALID_EXPORT_CODE",
          );
        }

        if (
          !Number.isSafeInteger(
            quantity,
          )
          || quantity <= 0
        ) {
          throw new Error(
            "INVALID_SELECTED_SEND_QUANTITY",
          );
        }

        const key =
          `${category}\u0000${code}`;

        if (seen.has(key)) {
          throw new Error(
            "DUPLICATE_EXPORT_CODE",
          );
        }

        seen.add(key);

        return {
          category,
          code,

          selected_send_quantity:
            quantity,
        };
      },
    );

  return {
    round_id:
      roundId,

    client_request_id:
      clientRequestId,

    items,
  };
}
