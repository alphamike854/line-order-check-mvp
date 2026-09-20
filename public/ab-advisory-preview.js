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
      });
    }
  }

  return rows;
}

function abPreviewOperationalText(
  rows = []
) {
  const byCode = new Map();

  for (const row of rows) {
    const code =
      String(row.code)
        .padStart(2, "0");

    if (!byCode.has(code)) {
      byCode.set(
        code,
        { A: 0, B: 0 }
      );
    }

    byCode.get(code)[row.category] +=
      Math.trunc(
        abPreviewNumber(row.quantity)
      );
  }

  const onlyA = [];
  const onlyB = [];
  const both = [];

  const codes =
    [...byCode.keys()]
      .sort(
        (a, b) =>
          Number(a) - Number(b)
          || a.localeCompare(b)
      );

  for (const code of codes) {
    const value = byCode.get(code);

    if (value.A > 0 && value.B > 0) {
      both.push(
        `${code}=${value.A}x${value.B}`
      );
    } else if (value.A > 0) {
      onlyA.push(
        `${code}=${value.A}`
      );
    } else if (value.B > 0) {
      onlyB.push(
        `${code}=${value.B}`
      );
    }
  }

  const sections = [];

  if (onlyA.length) {
    sections.push(
      `บ\n${onlyA.join("\n")}`
    );
  }

  if (onlyB.length) {
    sections.push(
      `ล\n${onlyB.join("\n")}`
    );
  }

  if (both.length) {
    sections.push(
      `บล\n${both.join("\n")}`
    );
  }

  return sections.join("\n\n");
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
  dashboard
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
    "เพดาน/รหัส",
    `บ ${abPreviewCap(plan.A)}`,
    `ล ${abPreviewCap(plan.B)}`,
  ].join("\n");

  const bubble2 =
    abPreviewOperationalText(rows);

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

  const batchLimit =
    Number(batchSelect?.value || 500);

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
    summaries.map((summary) => {
      if (
        summary.calculation_status
        !== "READY"
        || !summary.plan
      ) {
        return `
          <article
            class="ab-advisory-card"
          >
            <div class="ab-advisory-card-head">
              <strong>
                ${abPreviewEscape(
                  abPreviewGroupName(
                    summary.summary_group_id,
                    dashboard
                  )
                )}
              </strong>
            </div>
            <div class="ab-advisory-error">
              ยังไม่พร้อมคำนวณ
            </div>
          </article>
        `;
      }

      const messages =
        abPreviewBuildMessages(
          summary,
          batchLimit,
          dashboard
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
          <div class="ab-advisory-card-head">
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
            </span>
          </div>

          <div class="ab-advisory-bubbles">
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
                ${hasItems ? "" : "disabled"}
              >
                Copy
              </button>
            </div>
          </div>
        </article>
      `;
    }).join("");
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
    || typeof getSelectedSummaryGroup !== "function"
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

  const root =
    document.getElementById(
      "abAdvisoryPreview"
    );

  if (!batchSelect || !root) {
    return;
  }

  abAdvisoryPreviewContext = {
    getDashboard,
    getSelectedSummaryGroup,
    notify,
  };

  batchSelect.addEventListener(
    "change",
    () => {
      renderAbAdvisoryPreview({
        dashboard:
          abAdvisoryPreviewContext
            .getDashboard(),

        selectedSummaryGroup:
          abAdvisoryPreviewContext
            .getSelectedSummaryGroup(),
      });
    }
  );

  root.addEventListener(
    "click",
    async (event) => {
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
          dashboard
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
