const MAX_TEXT_LENGTH = 4500;
const MAX_MESSAGES = 5;


function assertPositiveInteger(
  value,
  label,
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(number)
    || number <= 0
  ) {
    throw new Error(label);
  }

  return number;
}


export function buildExportPreparationLineMessages({
  summaryGroupId,
  cycleNo,
  items,
}) {
  const group =
    String(
      summaryGroupId ?? "",
    ).trim();

  if (!group) {
    throw new Error(
      "EXPORT_MESSAGE_SUMMARY_GROUP_REQUIRED",
    );
  }

  const cycle =
    assertPositiveInteger(
      cycleNo,
      "EXPORT_MESSAGE_CYCLE_INVALID",
    );

  if (
    !Array.isArray(items)
    || items.length < 1
  ) {
    throw new Error(
      "EXPORT_MESSAGE_ITEMS_REQUIRED",
    );
  }

  const lines =
    items
      .map(
        (item) => {
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
            assertPositiveInteger(
              item.selected_send_quantity,
              "EXPORT_MESSAGE_QUANTITY_INVALID",
            );

          if (
            !/^[A-Z]+$/.test(category)
            || !/^[0-9]{1,3}$/.test(code)
          ) {
            throw new Error(
              "EXPORT_MESSAGE_CODE_INVALID",
            );
          }

          return {
            key:
              `${category}:${code}`,

            line:
              `${category}${code}=${quantity}`,
          };
        },
      )
      .sort(
        (a, b) =>
          a.key.localeCompare(
            b.key,
            "en",
          ),
      )
      .map(
        (entry) =>
          entry.line,
      );

  const header =
    `ส่งออก ${group} • ชุดที่ ${cycle}`;

  const chunks = [];
  let current =
    header;

  for (const line of lines) {
    const candidate =
      `${current}\n${line}`;

    if (
      candidate.length
      <= MAX_TEXT_LENGTH
    ) {
      current =
        candidate;

      continue;
    }

    chunks.push(current);
    current =
      line;
  }

  if (current) {
    chunks.push(current);
  }

  if (
    chunks.length < 1
    || chunks.length > MAX_MESSAGES
  ) {
    throw new Error(
      "EXPORT_LINE_MESSAGE_TOO_LARGE",
    );
  }

  return chunks.map(
    (text) => ({
      type:
        "text",

      text,
    }),
  );
}
