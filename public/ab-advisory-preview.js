function abPreviewNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function abPreviewFormat(value) {
  return Math.round(
    abPreviewNumber(value)
  ).toLocaleString("en-US");
}

function abPreviewEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function abPreviewTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }
  ).format(date);
}

function abPreviewCap(plan) {
  if (!plan) return "-";

  if (
    plan.common_retention_limit
      !== null
    && plan.common_retention_limit
      !== undefined
  ) {
    return abPreviewFormat(
      plan.common_retention_limit
    );
  }

  const min =
    plan.retention_limit_min;

  const max =
    plan.retention_limit_max;

  if (
    min === null
    || min === undefined
    || max === null
    || max === undefined
  ) {
    return "-";
  }

  if (Number(min) === Number(max)) {
    return abPreviewFormat(min);
  }

  return (
    `${abPreviewFormat(min)}`
    + "–"
    + `${abPreviewFormat(max)}`
  );
}

/*
 * Normal-round contract:
 * 500  -> 0 or 500
 * 1000 -> 0 or 1000
 * 2000 -> 0 or 2000
 *
 * This UI is preview-only.
 * No confirmed cut is produced here.
 */
function abPreviewBatchRows(
  plan,
  batchLimit
) {
  const limit =
    Math.trunc(
      abPreviewNumber(batchLimit)
    );

  if (![500, 1000, 2000].includes(limit)) {
    return [];
  }

  const rows = [];

  for (const category of ["A", "B"]) {
    for (
      const row
      of plan?.[category]
        ?.recommendations || []
    ) {
      const required =
        Math.trunc(
          abPreviewNumber(
            row.recommended_transfer
          )
        );

      const quantity =
        required >= limit
          ? limit
          : 0;

      if (quantity <= 0) continue;

      rows.push({
        category,

        code:
          String(row.code ?? "")
            .padStart(2, "0"),

        quantity,

        retained_before:
          Math.max(
            0,
            Math.trunc(
              abPreviewNumber(
                row.retained_before
              )
            )
          ),

        retention_limit:
          Math.max(
            0,
            Math.trunc(
              abPreviewNumber(
                row.retention_limit
              )
            )
          ),

        recommended_transfer:
          Math.max(
            0,
            Math.trunc(
              abPreviewNumber(
                row.recommended_transfer
              )
            )
          ),
      });
    }
  }

  return rows;
}

function abPreviewRowsByCode(
  rows = []
) {
  const map = new Map();

  for (const row of rows) {
    const category =
      row?.category;

    if (
      category !== "A"
      && category !== "B"
    ) {
      continue;
    }

    const code =
      String(row.code ?? "")
        .padStart(2, "0");

    if (!map.has(code)) {
      map.set(
        code,
        {
          code,
          A: null,
          B: null,
        }
      );
    }

    map.get(code)[category] = {
      quantity:
        Math.max(
          0,
          Math.trunc(
            abPreviewNumber(
              row.quantity
            )
          )
        ),

      retained_before:
        Math.max(
          0,
          Math.trunc(
            abPreviewNumber(
              row.retained_before
            )
          )
        ),

      retention_limit:
        Math.max(
          0,
          Math.trunc(
            abPreviewNumber(
              row.retention_limit
            )
          )
        ),

      recommended_transfer:
        Math.max(
          0,
          Math.trunc(
            abPreviewNumber(
              row.recommended_transfer
            )
          )
        ),
    };
  }

  return [...map.values()];
}


function abPreviewCodeCompare(
  left,
  right
) {
  return (
    Number(left) - Number(right)
    || String(left).localeCompare(
      String(right)
    )
  );
}


/*
 * Bubble 2 ordering.
 *
 * Reverse pair is adjacent only if both
 * codes already exist in the SAME section.
 *
 * Missing reverse codes are never created.
 */
function abPreviewOrderCodes(
  codes = []
) {
  const sorted =
    [
      ...new Set(
        codes.map(
          code =>
            String(code ?? "")
              .padStart(2, "0")
        )
      ),
    ]
      .filter(
        code =>
          /^\d{2}$/.test(code)
      )
      .sort(
        abPreviewCodeCompare
      );

  const available =
    new Set(sorted);

  const used =
    new Set();

  const blocks = [];

  for (const code of sorted) {
    if (used.has(code)) {
      continue;
    }

    const reverse =
      `${code[1]}${code[0]}`;

    if (
      reverse !== code
      && available.has(reverse)
      && !used.has(reverse)
    ) {
      const pair =
        [code, reverse]
          .sort(
            abPreviewCodeCompare
          );

      blocks.push(pair);

      used.add(code);
      used.add(reverse);

      continue;
    }

    blocks.push([code]);
    used.add(code);
  }

  blocks.sort(
    (left, right) =>
      abPreviewCodeCompare(
        left[0],
        right[0]
      )
  );

  return blocks.flat();
}


function abPreviewSplitRows(
  rows = []
) {
  const onlyA = [];
  const onlyB = [];
  const both = [];

  for (
    const entry
    of abPreviewRowsByCode(rows)
  ) {
    if (entry.A && entry.B) {
      both.push(entry);
    } else if (entry.A) {
      onlyA.push(entry);
    } else if (entry.B) {
      onlyB.push(entry);
    }
  }

  return {
    onlyA,
    onlyB,
    both,
  };
}


function abPreviewOrderEntries(
  entries = []
) {
  const byCode =
    new Map(
      entries.map(
        entry => [
          entry.code,
          entry,
        ]
      )
    );

  return abPreviewOrderCodes(
    entries.map(
      entry => entry.code
    )
  )
    .map(
      code =>
        byCode.get(code)
    )
    .filter(Boolean);
}


function abPreviewTemplate(
  value
) {
  const template =
    String(value || "A")
      .trim()
      .toUpperCase();

  return ["A", "B", "C"].includes(
    template
  )
    ? template
    : "A";
}


function abPreviewSectionQuantity(
  entries,
  category
) {
  const values =
    [
      ...new Set(
        entries.map(
          entry =>
            Math.trunc(
              abPreviewNumber(
                entry?.[category]
                  ?.quantity
              )
            )
        )
      ),
    ];

  return values.length === 1
    ? String(values[0])
    : null;
}


function abPreviewBothQuantity(
  entries
) {
  const values =
    [
      ...new Set(
        entries.map(
          entry =>
            `${Math.trunc(
              abPreviewNumber(
                entry?.A?.quantity
              )
            )}x${Math.trunc(
              abPreviewNumber(
                entry?.B?.quantity
              )
            )}`
        )
      ),
    ];

  return values.length === 1
    ? values[0]
    : null;
}


function abPreviewCompactSection(
  label,
  entries,
  quantity,
  template
) {
  if (!entries.length) {
    return "";
  }

  /*
   * Defensive fallback:
   * if a future batch contains mixed
   * quantities, show each code explicitly.
   */
  if (!quantity) {
    return (
      `${label}\n`
      + entries.map(
        entry => {
          if (entry.A && entry.B) {
            return (
              `${entry.code}=`
              + `${entry.A.quantity}`
              + "x"
              + `${entry.B.quantity}`
            );
          }

          const row =
            entry.A || entry.B;

          return (
            `${entry.code}=`
            + `${row.quantity}`
          );
        }
      ).join("\n")
    );
  }

  const codes =
    entries.map(
      entry => entry.code
    );

  /*
   * Template B
   *
   * บ =500
   * 04 40 06 60
   */
  if (template === "B") {
    return (
      `${label} =${quantity}`
      + "\n"
      + codes.join(" ")
    );
  }

  /*
   * Template C
   *
   * บ
   * 04
   * 40
   * 06
   * 60=500
   */
  if (template === "C") {
    const lines =
      [...codes];

    const last =
      lines.length - 1;

    lines[last] =
      `${lines[last]}=${quantity}`;

    return (
      `${label}\n`
      + lines.join("\n")
    );
  }

  /*
   * Template A
   *
   * บ
   * 04 40 06 60=500
   */
  return (
    `${label}\n`
    + `${codes.join(" ")}=${quantity}`
  );
}


function abPreviewOperationalText(
  rows = [],
  templateValue = "A"
) {
  const template =
    abPreviewTemplate(
      templateValue
    );

  const {
    onlyA,
    onlyB,
    both,
  } =
    abPreviewSplitRows(rows);

  const a =
    abPreviewOrderEntries(
      onlyA
    );

  const b =
    abPreviewOrderEntries(
      onlyB
    );

  const ab =
    abPreviewOrderEntries(
      both
    );

  const sections = [];

  if (a.length) {
    sections.push(
      abPreviewCompactSection(
        "บ",
        a,
        abPreviewSectionQuantity(
          a,
          "A"
        ),
        template
      )
    );
  }

  if (b.length) {
    sections.push(
      abPreviewCompactSection(
        "ล",
        b,
        abPreviewSectionQuantity(
          b,
          "B"
        ),
        template
      )
    );
  }

  if (ab.length) {
    sections.push(
      abPreviewCompactSection(
        "บล",
        ab,
        abPreviewBothQuantity(ab),
        template
      )
    );
  }

  return sections
    .filter(Boolean)
    .join("\n\n");
}


/*
 * Bubble 1 = stable audit view.
 *
 * บ / ล:
 * retained_before high -> low.
 *
 * บล:
 * combined A+B retained high -> low.
 */
function abPreviewAuditText(
  rows = []
) {
  const {
    onlyA,
    onlyB,
    both,
  } =
    abPreviewSplitRows(rows);

  const singleSort =
    category =>
      (left, right) =>
        (
          right[category]
            .retained_before
          -
          left[category]
            .retained_before
        )
        ||
        abPreviewCodeCompare(
          left.code,
          right.code
        );

  const bothSort =
    (left, right) =>
      (
        (
          right.A.retained_before
          + right.B.retained_before
        )
        -
        (
          left.A.retained_before
          + left.B.retained_before
        )
      )
      ||
      abPreviewCodeCompare(
        left.code,
        right.code
      );

  const a =
    [...onlyA].sort(
      singleSort("A")
    );

  const b =
    [...onlyB].sort(
      singleSort("B")
    );

  const ab =
    [...both].sort(
      bothSort
    );

  const sections = [
    "รหัสรอบนี้",
  ];

  if (a.length) {
    sections.push(
      "บ",

      ...a.map(
        entry =>
          `${entry.code} `
          + `${abPreviewFormat(
            entry.A.retained_before
          )}`
          + " | เกิน "
          + `${abPreviewFormat(
            entry.A.recommended_transfer
          )}`
      )
    );
  }

  if (b.length) {
    sections.push(
      "",
      "ล",

      ...b.map(
        entry =>
          `${entry.code} `
          + `${abPreviewFormat(
            entry.B.retained_before
          )}`
          + " | เกิน "
          + `${abPreviewFormat(
            entry.B.recommended_transfer
          )}`
      )
    );
  }

  if (ab.length) {
    sections.push(
      "",
      "บล",

      ...ab.map(
        entry =>
          `${entry.code} `
          + `บ ${abPreviewFormat(
            entry.A.retained_before
          )}`
          + ` เกิน ${abPreviewFormat(
            entry.A.recommended_transfer
          )}`
          + " | "
          + `ล ${abPreviewFormat(
            entry.B.retained_before
          )}`
          + ` เกิน ${abPreviewFormat(
            entry.B.recommended_transfer
          )}`
      )
    );
  }

  if (
    !a.length
    && !b.length
    && !ab.length
  ) {
    sections.push(
      "ไม่มีรายการ"
    );
  }

  return sections.join("\n");
}

function abPreviewGroupName(
  groupId,
  dashboard
) {
  const group =
    (dashboard?.summary_groups || [])
      .find(
        row =>
          row.id === groupId
      );

  return group?.name
    || groupId;
}

function abPreviewTotalRequired(
  plan
) {
  return Math.max(
    0,
    Math.trunc(
      abPreviewNumber(
        plan?.transfer_required_total
      )
    )
  );
}

function abPreviewBatchTotal(
  rows
) {
  return (rows || []).reduce(
    (total, row) =>
      total
      + Math.max(
        0,
        Math.trunc(
          abPreviewNumber(
            row.quantity
          )
        )
      ),
    0
  );
}

function abPreviewBuildMessages(
  summary,
  batchLimit,
  dashboard,
  templateValue = "A"
) {
  const plan = summary?.plan;

  if (!plan) {
    return null;
  }

  const rows =
    abPreviewBatchRows(
      plan,
      batchLimit
    );

  const totalRequired =
    abPreviewTotalRequired(
      plan
    );

  const batchTotal =
    abPreviewBatchTotal(
      rows
    );

  const auditText =
    abPreviewAuditText(
      rows
    );

  const bubble1 = [
    `${abPreviewGroupName(
      summary.summary_group_id,
      dashboard
    )} | ${abPreviewTime(
      dashboard?.generated_at
    )}`,

    "",

    `ยอดรวม ${
      abPreviewFormat(
        plan.gross_received
      )
    }`,

    `ยอดหลังหัก ${
      abPreviewFormat(
        plan.adjusted_received
      )
    }`,

    "",

    `ยอดต้องตัดทั้งหมด ${
      abPreviewFormat(
        totalRequired
      )
    }`,

    `ยอดตัดรอบนี้ ${
      abPreviewFormat(
        batchTotal
      )
    }`,

    "",

    auditText,

    "",

    "เพดาน/รหัส",

    `บ ${abPreviewCap(plan.A)}`,

    `ล ${abPreviewCap(plan.B)}`,
  ].join("\n");

  const bubble2 =
    abPreviewOperationalText(
      rows,
      templateValue
    );

  return {
    bubble1,
    bubble2,
    batchRows: rows,
  };
}

function renderAbAdvisoryPreview({
  dashboard = null,
  selectedSummaryGroup = "ALL",
} = {}) {
  const root =
    document.getElementById(
      "abAdvisoryPreview"
    );

  if (!root) return;

  const advisory =
    dashboard?.ab_advisory;

  if (!advisory) {
    root.innerHTML =
      '<div class="ab-advisory-empty">'
      + 'ยังไม่มีข้อมูลเตรียมส่งออก'
      + "</div>";

    return;
  }

  if (
    advisory.calculation_status
    === "ERROR"
  ) {
    root.innerHTML =
      '<div class="ab-advisory-error">'
      + 'คำนวณข้อเสนอส่งออกไม่สำเร็จ'
      + "</div>";

    return;
  }

  const batchSelect =
    document.getElementById(
      "abAdvisoryBatchSelect"
    );

  const templateSelect =
    document.getElementById(
      "abAdvisoryTemplateSelect"
    );

  const batchLimit =
    Number(
      batchSelect?.value || 500
    );

  const template =
    abPreviewTemplate(
      templateSelect?.value || "A"
    );

  const selected =
    selectedSummaryGroup
    || "ALL";

  let summaries =
    advisory.summary_groups
    || [];

  if (selected !== "ALL") {
    summaries =
      summaries.filter(
        row =>
          row.summary_group_id
          === selected
      );
  }

  if (!summaries.length) {
    root.innerHTML =
      '<div class="ab-advisory-empty">'
      + 'ไม่มีข้อมูล A/B ของกลุ่มนี้'
      + "</div>";

    return;
  }

  root.innerHTML =
    summaries.map(
      summary => {
        if (
          summary.calculation_status
          !== "READY"
          || !summary.plan
        ) {
          return `
            <article
              class="ab-advisory-card"
            >
              <div
                class="ab-advisory-card-head"
              >
                <strong>
                  ${abPreviewEscape(
                    abPreviewGroupName(
                      summary.summary_group_id,
                      dashboard
                    )
                  )}
                </strong>
              </div>

              <div
                class="ab-advisory-error"
              >
                ยังไม่พร้อมคำนวณ
              </div>
            </article>
          `;
        }

        const messages =
          abPreviewBuildMessages(
            summary,
            batchLimit,
            dashboard,
            template
          );

        const hasItems =
          messages.batchRows.length > 0;

        return `
          <article
            class="ab-advisory-card"
            data-summary-group-id="${
              abPreviewEscape(
                summary.summary_group_id
              )
            }"
          >
            <div
              class="ab-advisory-card-head"
            >
              <strong>
                ${abPreviewEscape(
                  abPreviewGroupName(
                    summary.summary_group_id,
                    dashboard
                  )
                )}
              </strong>

              <span>
                รอบ ${abPreviewFormat(
                  batchLimit
                )}
                · แบบ ${abPreviewEscape(
                  template
                )}
              </span>
            </div>

            <div
              class="ab-advisory-bubbles"
            >
              <pre
                class="ab-advisory-bubble"
              >${abPreviewEscape(
                messages.bubble1
              )}</pre>

              <div
                class="ab-advisory-copy-block"
              >
                <pre
                  class="ab-advisory-bubble ab-advisory-bubble-copy"
                >${abPreviewEscape(
                  hasItems
                    ? messages.bubble2
                    : "ไม่มีรายการรอบนี้"
                )}</pre>

                <button
                  type="button"
                  class="button ghost small ab-advisory-copy-button"
                  data-summary-group-id="${
                    abPreviewEscape(
                      summary.summary_group_id
                    )
                  }"
                  ${
                    hasItems
                      ? ""
                      : "disabled"
                  }
                >
                  Copy
                </button>
              </div>
            </div>
          </article>
        `;
      }
    ).join("");
}

async function abPreviewCopy(text) {
  if (!text) return false;

  if (
    navigator.clipboard
    && navigator.clipboard.writeText
  ) {
    await navigator.clipboard.writeText(
      text
    );

    return true;
  }

  const textarea =
    document.createElement("textarea");

  textarea.value = text;
  textarea.setAttribute(
    "readonly",
    ""
  );

  textarea.style.position =
    "fixed";

  textarea.style.opacity =
    "0";

  document.body.append(textarea);
  textarea.select();

  const ok =
    document.execCommand("copy");

  textarea.remove();

  return ok;
}

let abAdvisoryPreviewBound = false;
let abAdvisoryPreviewContext = null;

function bindAbAdvisoryPreviewControls({
  getDashboard,
  getSelectedSummaryGroup,
  notify,
} = {}) {
  if (abAdvisoryPreviewBound) {
    return;
  }

  if (
    typeof getDashboard !== "function"
    || typeof getSelectedSummaryGroup
      !== "function"
    || typeof notify !== "function"
  ) {
    throw new Error(
      "AB_ADVISORY_PREVIEW_CONTEXT_REQUIRED"
    );
  }

  const batchSelect =
    document.getElementById(
      "abAdvisoryBatchSelect"
    );

  const templateSelect =
    document.getElementById(
      "abAdvisoryTemplateSelect"
    );

  const root =
    document.getElementById(
      "abAdvisoryPreview"
    );

  if (
    !batchSelect
    || !templateSelect
    || !root
  ) {
    return;
  }

  abAdvisoryPreviewContext = {
    getDashboard,
    getSelectedSummaryGroup,
    notify,
  };

  const rerender =
    () => {
      renderAbAdvisoryPreview({
        dashboard:
          abAdvisoryPreviewContext
            .getDashboard(),

        selectedSummaryGroup:
          abAdvisoryPreviewContext
            .getSelectedSummaryGroup(),
      });
    };

  batchSelect.addEventListener(
    "change",
    rerender
  );

  templateSelect.addEventListener(
    "change",
    rerender
  );

  root.addEventListener(
    "click",

    async event => {
      const button =
        event.target.closest(
          ".ab-advisory-copy-button"
        );

      if (!button) return;

      const dashboard =
        abAdvisoryPreviewContext
          .getDashboard();

      const groupId =
        button.dataset.summaryGroupId;

      const summary =
        (
          dashboard
            ?.ab_advisory
            ?.summary_groups
          || []
        ).find(
          row =>
            row.summary_group_id
            === groupId
        );

      if (!summary) return;

      const messages =
        abPreviewBuildMessages(
          summary,

          Number(
            batchSelect.value || 500
          ),

          dashboard,

          abPreviewTemplate(
            templateSelect.value
          )
        );

      if (!messages?.bubble2) {
        return;
      }

      try {
        const ok =
          await abPreviewCopy(
            messages.bubble2
          );

        if (!ok) {
          throw new Error(
            "COPY_FAILED"
          );
        }

        abAdvisoryPreviewContext.notify(
          "คัดลอกรายการแล้ว",
          false
        );
      } catch {
        abAdvisoryPreviewContext.notify(
          "คัดลอกไม่สำเร็จ",
          true
        );
      }
    }
  );

  abAdvisoryPreviewBound = true;
}
