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
 * Calculation-only contract.
 *
 * FIXED:
 *   500..5000 in 500-unit steps.
 *
 * AUTO:
 *   floor recommendation to nearest 500,
 *   capped at 5000 per A/B category + code.
 *
 * SWEEP:
 *   floor every recommendation to 500-unit
 *   steps, then split it across batches with
 *   max 5000 per category + code + batch.
 *   Residual <500 remains waiting.
 *
 * SWEEP_EXACT:
 *   use the exact recommendation without
 *   500-unit rounding, split across batches
 *   with max 5000 per category + code + batch.
 *   Residual is always zero.
 *
 * Preview only:
 * no DB write, confirmed cut or LINE send.
 */
function abPreviewBatchRow(
  category,
  row,
  quantity,
  required
) {
  return {
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
      required,
  };
}


function abPreviewSweepBatches(
  plan
) {
  const batches = [];

  for (const category of ["A", "B"]) {
    for (
      const row
      of plan?.[category]
        ?.recommendations || []
    ) {
      const required =
        Math.max(
          0,
          Math.trunc(
            abPreviewNumber(
              row.recommended_transfer
            )
          )
        );

      let remaining =
        Math.floor(
          required / 500
        ) * 500;

      let batchIndex = 0;

      while (remaining > 0) {
        const quantity =
          Math.min(
            5000,
            remaining
          );

        if (!batches[batchIndex]) {
          batches[batchIndex] = [];
        }

        batches[batchIndex].push(
          abPreviewBatchRow(
            category,
            row,
            quantity,
            required
          )
        );

        remaining -= quantity;
        batchIndex += 1;
      }
    }
  }

  return batches;
}


function abPreviewSweepExactBatches(
  plan
) {
  const batches = [];

  for (const category of ["A", "B"]) {
    for (
      const row
      of plan?.[category]
        ?.recommendations || []
    ) {
      const required =
        Math.max(
          0,
          Math.trunc(
            abPreviewNumber(
              row.recommended_transfer
            )
          )
        );

      let remaining =
        required;

      let batchIndex = 0;

      while (remaining > 0) {
        const quantity =
          Math.min(
            5000,
            remaining
          );

        if (!batches[batchIndex]) {
          batches[batchIndex] = [];
        }

        batches[batchIndex].push(
          abPreviewBatchRow(
            category,
            row,
            quantity,
            required
          )
        );

        remaining -= quantity;
        batchIndex += 1;
      }
    }
  }

  return batches;
}


function abPreviewBatchRows(
  plan,
  batchMode
) {
  const rawMode =
    String(
      batchMode ?? "500"
    )
      .trim()
      .toUpperCase();

  const automatic =
    rawMode === "AUTO";

  const sweep =
    rawMode === "SWEEP";

  const sweepExact =
    rawMode === "SWEEP_EXACT";

  if (
    sweep
    || sweepExact
  ) {
    const batches =
      sweepExact
        ? abPreviewSweepExactBatches(
            plan
          )
        : abPreviewSweepBatches(
            plan
          );

    return (
      batches[0]
      || []
    );
  }

  const limit =
    automatic
      ? null
      : Math.trunc(
          abPreviewNumber(
            batchMode
          )
        );

  if (
    !automatic
    && (
      limit < 500
      || limit > 5000
      || limit % 500 !== 0
    )
  ) {
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
        Math.max(
          0,
          Math.trunc(
            abPreviewNumber(
              row.recommended_transfer
            )
          )
        );

      const quantity =
        automatic
          ? Math.min(
              5000,
              Math.floor(
                required / 500
              ) * 500
            )
          : (
              required >= limit
                ? limit
                : 0
            );

      if (quantity <= 0) {
        continue;
      }

      rows.push(
        abPreviewBatchRow(
          category,
          row,
          quantity,
          required
        )
      );
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


/*
 * Copy ordering follows the audit view.
 *
 * บ / ล:
 *   retained order quantity high -> low.
 *
 * บล:
 *   combined A+B retained high -> low.
 *
 * Code ascending is tie-break only.
 */
function abPreviewOrderEntries(
  entries = [],
  category = null
) {
  const retained =
    entry => {
      if (
        category === "A"
        || category === "B"
      ) {
        return abPreviewNumber(
          entry?.[category]
            ?.retained_before
        );
      }

      return (
        abPreviewNumber(
          entry?.A?.retained_before
        )
        +
        abPreviewNumber(
          entry?.B?.retained_before
        )
      );
    };

  return [...entries]
    .sort(
      (left, right) =>
        retained(right)
        - retained(left)
        ||
        abPreviewCodeCompare(
          left.code,
          right.code
        )
    );
}


function abPreviewBatchLabel(
  value
) {
  const mode =
    String(
      value ?? "500"
    )
      .trim()
      .toUpperCase();

  if (mode === "AUTO") {
    return "อัตโนมัติ";
  }

  if (mode === "SWEEP") {
    return "กวาดทั้งหมด (ขั้น 500)";
  }

  if (mode === "SWEEP_EXACT") {
    return "กวาดทั้งหมด (ยอดจริง)";
  }

  return abPreviewFormat(
    mode
  );
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
      onlyA,
      "A"
    );

  const b =
    abPreviewOrderEntries(
      onlyB,
      "B"
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
 * SWEEP operational format.
 *
 * No A/B prefix is ever shown beside a code.
 *
 * A only -> บ
 * B only -> ล
 * A+B    -> บล
 *
 * SWEEP intentionally uses one code per line
 * even when quantities are equal.
 */
function abPreviewSweepOperationalText(
  rows = []
) {
  const {
    onlyA,
    onlyB,
    both,
  } =
    abPreviewSplitRows(rows);

  const a =
    abPreviewOrderEntries(
      onlyA,
      "A"
    );

  const b =
    abPreviewOrderEntries(
      onlyB,
      "B"
    );

  const ab =
    abPreviewOrderEntries(
      both
    );

  const sections = [];

  if (a.length) {
    sections.push(
      [
        "บ",

        ...a.map(
          entry =>
            `${entry.code}=`
            + `${entry.A.quantity}`
        ),
      ].join("\n")
    );
  }

  if (b.length) {
    sections.push(
      [
        "ล",

        ...b.map(
          entry =>
            `${entry.code}=`
            + `${entry.B.quantity}`
        ),
      ].join("\n")
    );
  }

  if (ab.length) {
    sections.push(
      [
        "บล",

        ...ab.map(
          entry =>
            `${entry.code}=`
            + `${entry.A.quantity}`
            + "x"
            + `${entry.B.quantity}`
        ),
      ].join("\n")
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
  rows = [],
  {
    plan = null,
    v3 = false,
  } = {}
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

  if (!v3) {
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

  const capA =
    abPreviewCap(plan?.A);

  const capB =
    abPreviewCap(plan?.B);

  const sections = [];

  if (a.length) {
    sections.push(
      `บ · ${abPreviewFormat(a.length)} รหัส · เพดาน ${capA}`,

      ...a.map(
        entry =>
          `${entry.code}  `
          + `${abPreviewFormat(
            entry.A.retained_before
          )}`
          + `  (+${abPreviewFormat(
            entry.A.recommended_transfer
          )})`
      )
    );
  }

  if (b.length) {
    if (sections.length) {
      sections.push("");
    }

    sections.push(
      `ล · ${abPreviewFormat(b.length)} รหัส · เพดาน ${capB}`,

      ...b.map(
        entry =>
          `${entry.code}  `
          + `${abPreviewFormat(
            entry.B.retained_before
          )}`
          + `  (+${abPreviewFormat(
            entry.B.recommended_transfer
          )})`
      )
    );
  }

  if (ab.length) {
    if (sections.length) {
      sections.push("");
    }

    sections.push(
      `บล · ${abPreviewFormat(ab.length)} รหัส · เพดาน บ ${capA} / ล ${capB}`,

      ...ab.map(
        entry =>
          `${entry.code}  `
          + `บ ${abPreviewFormat(
            entry.A.retained_before
          )}`
          + ` (+${abPreviewFormat(
            entry.A.recommended_transfer
          )})`
          + "  "
          + `ล ${abPreviewFormat(
            entry.B.retained_before
          )}`
          + ` (+${abPreviewFormat(
            entry.B.recommended_transfer
          )})`
      )
    );
  }

  if (
    !a.length
    && !b.length
    && !ab.length
  ) {
    sections.push(
      "ไม่มีรายการรอบนี้"
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

  const rawMode =
    String(
      batchLimit ?? "500"
    )
      .trim()
      .toUpperCase();

  const sweep =
    rawMode === "SWEEP";

  const sweepExact =
    rawMode === "SWEEP_EXACT";

  const multiBatch =
    sweep
    || sweepExact;

  const batches =
    multiBatch
      ? (
          sweepExact
            ? abPreviewSweepExactBatches(
                plan
              )
            : abPreviewSweepBatches(
                plan
              )
        )
      : (() => {
          const rows =
            abPreviewBatchRows(
              plan,
              batchLimit
            );

          return rows.length
            ? [rows]
            : [];
        })();

  const allRows =
    batches.flat();

  const totalRequired =
    abPreviewTotalRequired(
      plan
    );

  const batchTotal =
    abPreviewBatchTotal(
      allRows
    );

  const remainingRequired =
    Math.max(
      0,
      totalRequired - batchTotal
    );

  /*
   * Every sweepable code appears in batch 1.
   * Use it for the audit list so a code is
   * never duplicated in Bubble 1.
   */
  const auditRows =
    multiBatch
      ? (
          batches[0]
          || []
        )
      : allRows;

  const auditText =
    abPreviewAuditText(
      auditRows,
      {
        plan,
        v3: true,
      }
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

    `ยอดสุทธิ ${
      abPreviewFormat(
        plan.adjusted_received
      )
    }`,

    "",

    `ต้องส่งออกทั้งหมด ${
      abPreviewFormat(
        totalRequired
      )
    }`,

    `ส่งออกรอบนี้ ${
      abPreviewFormat(
        batchTotal
      )
    }`,

    `เหลือรอส่งออก ${
      abPreviewFormat(
        remainingRequired
      )
    }`,

    "",

    auditText,
  ].join("\n");

  const copyBatches =
    batches.map(
      (rows, index) => ({
        batch_no:
          index + 1,

        rows,

        text:
          multiBatch
            ? abPreviewSweepOperationalText(
                rows
              )
            : abPreviewOperationalText(
                rows,
                templateValue
              ),
      })
    )
      .filter(
        batch =>
          Boolean(
            batch.text.trim()
          )
      );

  const bubble2 =
    copyBatches
      .map(
        batch => batch.text
      )
      .join("\n\n");

  return {
    bubble1,
    bubble2,

    batchRows:
      allRows,

    copyBatches,

    sweep:
      multiBatch,

    sweepExact,
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

  const batchMode =
    batchSelect?.value
    || "500";

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
            batchMode,
            dashboard,
            template
          );

        const hasItems =
          messages.copyBatches
            .length > 0;

        const copyBlocks =
          hasItems
            ? messages.copyBatches
                .map(
                  (batch, index) => `
                    <div
                      class="ab-advisory-copy-block"
                    >
                      ${
                        messages.sweep
                          ? `
                            <div
                              class="muted small-text"
                            >
                              ชุด ${abPreviewEscape(
                                batch.batch_no
                              )}
                            </div>
                          `
                          : ""
                      }

                      <pre
                        class="ab-advisory-bubble ab-advisory-bubble-copy"
                      >${abPreviewEscape(
                        batch.text
                      )}</pre>

                      <button
                        type="button"
                        class="button ghost small ab-advisory-copy-button"
                        data-summary-group-id="${
                          abPreviewEscape(
                            summary.summary_group_id
                          )
                        }"
                        data-batch-index="${
                          index
                        }"
                      >
                        ${
                          messages.sweep
                            ? `Copy ชุด ${abPreviewEscape(
                                batch.batch_no
                              )}`
                            : "Copy"
                        }
                      </button>
                    </div>
                  `
                )
                .join("")
            : `
                <div
                  class="ab-advisory-copy-block"
                >
                  <pre
                    class="ab-advisory-bubble ab-advisory-bubble-copy"
                  >ไม่มีรายการรอบนี้</pre>

                  <button
                    type="button"
                    class="button ghost small ab-advisory-copy-button"
                    disabled
                  >
                    Copy
                  </button>
                </div>
              `;

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
                คำนวณ ${abPreviewEscape(
                  abPreviewBatchLabel(
                    batchMode
                  )
                )}
                ${
                  messages.sweep
                    ? ""
                    : `· แบบ ${abPreviewEscape(
                        template
                      )}`
                }
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

              ${copyBlocks}
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

          batchSelect.value
          || "500",

          dashboard,

          abPreviewTemplate(
            templateSelect.value
          )
        );

      const batchIndex =
        Math.max(
          0,
          Math.trunc(
            abPreviewNumber(
              button.dataset
                .batchIndex
              ?? 0
            )
          )
        );

      const copyBatch =
        messages
          ?.copyBatches
          ?.[batchIndex];

      if (!copyBatch?.text) {
        return;
      }

      try {
        const ok =
          await abPreviewCopy(
            copyBatch.text
          );

        if (!ok) {
          throw new Error(
            "COPY_FAILED"
          );
        }

        abAdvisoryPreviewContext.notify(
          messages.sweep
            ? `คัดลอกชุด ${copyBatch.batch_no} แล้ว`
            : "คัดลอกรายการแล้ว",
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
