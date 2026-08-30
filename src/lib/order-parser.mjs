"use strict";

/**
 * LINE Order Parser v1.7.6
 * Pure JavaScript, no external dependencies.
 *
 * Design goals:
 * - deterministic parser: same input + config => same output
 * - independent from Google Sheets / Make / database
 * - configurable category aliases
 * - REVIEW instead of guessing when grammar is ambiguous
 */

const PARSER_VERSION = "1.7.6";

const DEFAULT_CONFIG = {
  aliases: {
    "A": "A",
    "B": "B",
    "C": "C",
    "D": "D",
    "E": "E",
    "F": "F",
    "G": "G",
    "DOUBLE": "DOUBLE",
    "น": "A",
    "บล": "AB",
    "ก": "C",
    "บลก": "ABC",
    "รูด": "D",
    "รูดเบิ้ล": "DOUBLE",
    "ทุกกลับ": "PERMUTE_ALL",
    "3ปต": "PERMUTE_ALL",
    "3 ปต": "PERMUTE_ALL",
    "3ประตู": "PERMUTE_ALL",
    "3 ประตู": "PERMUTE_ALL",
    "6ปต": "PERMUTE_ALL",
    "6 ปต": "PERMUTE_ALL",
    "6ประตู": "PERMUTE_ALL",
    "6 ประตู": "PERMUTE_ALL",
    "6กลับ": "PERMUTE_ALL",
    "6 กลับ": "PERMUTE_ALL",
    "หกกลับ": "PERMUTE_ALL",
    "หก กลับ": "PERMUTE_ALL",
    "โต๊ด": "F",
    "H": "H",
    "L": "L",
    "วิ่งบน": "H",
    "วิ่ง บ": "H",
    "วิ่งล่าง": "L",
    "วิ่ง ล": "L"
  },
  defaultCategoryByCodeLength: {
    2: "A",
    3: "E"
  }
};

function mergeConfig(config = {}) {
  const aliases = { ...DEFAULT_CONFIG.aliases };
  for (const [alias, target] of Object.entries(config.aliases || {})) {
    aliases[alias] = String(target).toUpperCase();
    aliases[normalizeLatin(alias)] = String(target).toUpperCase();
  }
  return {
    aliases,
    defaultCategoryByCodeLength: {
      ...DEFAULT_CONFIG.defaultCategoryByCodeLength,
      ...(config.defaultCategoryByCodeLength || {})
    }
  };
}

function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[×✕✖]/g, "x")
    .replace(/[–—]/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function normalizeContextualShortDateMetadata(text) {
  const lines = String(text || "").split("\n");
  const out = [];

  const exactShortDate =
    /^(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])$/u;

  const inlineShortDate =
    /(?:^|\s)(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])(?:$|\s)/u;

  const dateContext =
    /(?:ลาว|วันที่|งวด)/u;

  const hasOrderOperator =
    /[=xX*×]/u;

  const previousNonBlank = (index) => {
    for (let i = index - 1; i >= 0; i--) {
      const candidate =
        String(lines[i] || "").trim();

      if (candidate) return candidate;
    }

    return "";
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] || "");
    const line = raw.trim();

    if (!line) {
      out.push(raw);
      continue;
    }

    // "ลาว 28/8"
    //
    // Require an explicit date-context word and no assignment/
    // multiplication operator. This deliberately does NOT make
    // every D/M slash expression metadata.
    if (
      dateContext.test(line)
      && inlineShortDate.test(line)
      && !hasOrderOperator.test(line)
    ) {
      continue;
    }

    // "ลาวๆ"
    // "28/8"
    //
    // A bare short date is metadata only when immediately preceded
    // by a narrow known date-context line.
    if (exactShortDate.test(line)) {
      const previous =
        previousNonBlank(i);

      if (
        previous
        && dateContext.test(previous)
        && !/\d/u.test(previous)
        && !hasOrderOperator.test(previous)
      ) {
        continue;
      }
    }

    out.push(raw);
  }

  return out.join("\n");
}

function normalizeMixedWidthInlineAssignments(text) {
  const lines = String(text || "").split("\n");
  const out = [];

  const quantityToken =
    String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`;

  const pairPattern =
    new RegExp(
      `^(.+?)\\s*=\\s*(${quantityToken}\\s*[xX*×]\\s*${quantityToken})\\s*$`,
      "u",
    );

  for (const raw of lines) {
    const line = String(raw || "").trim();
    const match = line.match(pairPattern);

    if (!match) {
      out.push(raw);
      continue;
    }

    const left = match[1].trim();
    const quantity = match[2];

    // Keep this normalizer deliberately narrow:
    // only plain comma/space-separated numeric codes.
    if (!/^[0-9,\s]+$/u.test(left)) {
      out.push(raw);
      continue;
    }

    const codes =
      left
        .split(/[,\s]+/u)
        .filter(Boolean);

    if (
      codes.length < 2
      || codes.some(
        (code) =>
          !/^\d{2}$/.test(code)
          && !/^\d{3}$/.test(code)
      )
    ) {
      out.push(raw);
      continue;
    }

    const twoDigit =
      codes.filter(
        (code) => /^\d{2}$/.test(code)
      );

    const threeDigit =
      codes.filter(
        (code) => /^\d{3}$/.test(code)
      );

    if (
      !twoDigit.length
      || !threeDigit.length
    ) {
      out.push(raw);
      continue;
    }

    // Send each width through its existing canonical grammar.
    // No category semantics are invented here.
    out.push(
      `${threeDigit.join(" ")}=${quantity}`
    );

    out.push(
      `${twoDigit.join(" ")}=${quantity}`
    );
  }

  return out.join("\n");
}

function isStandaloneDateMetadataLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return false;

  // Full D/M/YY or D-M-YY metadata, optionally surrounded by names/emoji.
  // Two-part slash syntax such as 07/70 is deliberately NOT a date.
  return /^(?:[^\d\n]*\s*)?(?:0?[1-9]|[12]\d|3[01])([/-])(?:0?[1-9]|1[0-2])\1(?:[2-9]\d|\d{4})(?:\s*[^\d\n]*)?$/u.test(raw);
}

function isSafeTwoDigitCodeListLine(line) {
  const raw = String(line || "").trim();
  if (!raw || isStandaloneDateMetadataLine(raw)) return false;

  const parts = raw.split(/[\s,-]+/u).filter(Boolean);
  if (!parts.length || parts.some((part) => !/^\d{2}$/.test(part))) {
    return false;
  }

  const residue = raw
    .replace(/\d{2}/g, "")
    .replace(/[\s,-]/g, "");

  return !residue;
}

function normalizeSafeReviewGrammar(text) {
  const lines = String(text || "").split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = String(rawLine || "").trim();

    if (!line) {
      out.push("");
      continue;
    }

    // Gold Review grammar:
    //
    // บล 5000x5000
    // 05-50 38-83
    // 56-65
    //
    // becomes:
    //
    // บล
    // 05-50 38-83
    // 56-65
    // =5000x5000
    //
    // Keep this narrow: an explicit combined A/B context and a PAIR
    // quantity are required before moving quantity across the code block.
    const prefixQuantity = line.match(
      /^((?:บลก|บล|ล-บ|บ-ล|บน-ล่าง|ล่าง-บน))\s+(\d+\s*[xX*]\s*\d+)$/u
    );

    if (prefixQuantity) {
      const codeLines = [];
      let j = i + 1;

      while (j < lines.length) {
        const candidate = String(lines[j] || "").trim();

        if (
          !candidate ||
          !isSafeTwoDigitCodeListLine(candidate)
        ) {
          break;
        }

        codeLines.push(candidate);
        j++;
      }

      if (codeLines.length) {
        out.push(prefixQuantity[1]);
        out.push(...codeLines);
        out.push(`=${prefixQuantity[2]}`);
        i = j - 1;
        continue;
      }
    }

    // Gold Review grammar:
    //
    // 16
    // 39
    // -500 บลก
    //
    // => =500 บลก
    //
    // Require prior 2-digit codes plus an explicit known modifier.
    const leadingDashQuantity = line.match(
      /^-\s*(\d+(?:\s*[xX*\/]\s*\d+)?)(\s+(?:บลก|บล))$/u
    );

    if (
      leadingDashQuantity &&
      out.length &&
      isSafeTwoDigitCodeListLine(out[out.length - 1])
    ) {
      out.push(
        `=${leadingDashQuantity[1]}${leadingDashQuantity[2]}`
      );
      continue;
    }

    // Gold Review grammar:
    //
    // 31-300 บลก
    // 40 16 93 91-500 บลก
    //
    // => '=' assignment.
    //
    // Deliberately require:
    // - only 2-digit codes on the left
    // - quantity >= 3 digits (or a pair beginning with >=3 digits)
    // - explicit บล/บลก modifier
    //
    // Therefore ambiguous code lists such as 05-50 stay untouched.
    const inlineDashAssignment = line.match(
      /^((?:\d{2})(?:[\s,/:]+\d{2})*)\s*-\s*(\d{3,}(?:\s*[xX*\/]\s*\d+)?)(\s+(?:บลก|บล))$/u
    );

    if (inlineDashAssignment) {
      out.push(
        `${inlineDashAssignment[1]}=${inlineDashAssignment[2]}${inlineDashAssignment[3]}`
      );
      continue;
    }

    out.push(rawLine);
  }

  return out.join("\n");
}

function normalizeCombinedTwoDigitDirection(text) {
  const raw = String(text || "").trim();

  if (
    /^(?:บน\s*[-/*+]\s*ล่าง|ล่าง\s*[-/*+]\s*บน|บ\s*[-/*+]\s*ล|ล\s*[-/*+]\s*บ)$/u.test(raw)
  ) {
    return "บนล่าง";
  }

  return raw;
}

function extractSafeTwoDigitCodeList(line) {
  const raw = String(line || "").trim();

  if (
    !raw ||
    isStandaloneDateMetadataLine(raw)
  ) {
    return null;
  }

  const parts = raw
    .split(/[\s,-]+/u)
    .filter(Boolean);

  if (
    !parts.length ||
    parts.some((part) => !/^\d{2}$/.test(part))
  ) {
    return null;
  }

  const residue = raw
    .replace(/\d{2}/g, "")
    .replace(/[\s,-]/g, "");

  return residue ? null : parts;
}

function parseSafeCollectiveQuantityLine(line) {
  const raw = String(line || "").trim();

  let m = raw.match(
    /^(?:ตัวละ|ทุกตัว(?:ละ)?)\s*(\d+(?:\s*[xX*\/]\s*\d+)?)(?:\s+(.+))?$/u
  );

  if (!m) return null;

  let direction = null;

  if (m[2]) {
    const normalizedDirection =
      normalizeCombinedTwoDigitDirection(m[2]);

    if (
      normalizedDirection === "บนล่าง" ||
      normalizedDirection === "บล" ||
      normalizedDirection === "บลก"
    ) {
      direction = normalizedDirection;
    } else {
      return null;
    }
  }

  return {
    quantity: m[1],
    direction,
  };
}

function normalizeCollectiveReviewGrammar(text) {
  const lines = String(text || "").split("\n");
  const out = [];

  const directionHeader = (line) => {
    const normalized =
      normalizeCombinedTwoDigitDirection(line);

    if (normalized === "บนล่าง") return "บนล่าง";
    if (/^(?:บน|บ)$/u.test(normalized)) return "บน";
    if (/^(?:ล่าง|ล)$/u.test(normalized)) return "ล่าง";

    return null;
  };

  const emitDirectionalBlocks = (blockLines, quantity) => {
    const blocks = [];
    let current = null;

    for (const raw of blockLines) {
      const header = directionHeader(raw);

      if (header) {
        current = {
          header,
          codes: [],
        };
        blocks.push(current);
        continue;
      }

      const codes = extractSafeTwoDigitCodeList(raw);

      if (
        !current ||
        !codes
      ) {
        return null;
      }

      current.codes.push(...codes);
    }

    if (
      !blocks.length ||
      blocks.some((block) => !block.codes.length)
    ) {
      return null;
    }

    return blocks.flatMap((block) => [
      block.header,
      `${block.codes.join(" ")}=${quantity}`,
    ]);
  };

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    let line = String(original || "").trim();

    if (!line) {
      out.push("");
      continue;
    }

    // --------------------------------------------------------
    // Exact combined-direction aliases:
    // บ/ล, บ*ล, บ-ล, บ+ล, บน*ล่าง, บน-ล่าง, ...
    // --------------------------------------------------------
    const normalizedDirection =
      normalizeCombinedTwoDigitDirection(line);

    if (
      normalizedDirection === "บนล่าง" &&
      normalizedDirection !== line
    ) {
      out.push("บนล่าง");
      continue;
    }

    // --------------------------------------------------------
    // Prefix collective form:
    //
    // บน-ล่าง ตัวละ 30
    // 44
    // 35
    // 53
    //
    // => บนล่าง
    //    44 35 53=30
    // --------------------------------------------------------
    const prefixCollective = line.match(
      /^(.+?)\s+(?:ตัวละ|ทุกตัว(?:ละ)?)\s*(\d+(?:\s*[xX*\/]\s*\d+)?)$/u
    );

    if (prefixCollective) {
      const header =
        normalizeCombinedTwoDigitDirection(
          prefixCollective[1]
        );

      if (
        header === "บนล่าง" ||
        header === "บล" ||
        header === "บลก"
      ) {
        const codes = [];
        let j = i + 1;

        while (j < lines.length) {
          const found =
            extractSafeTwoDigitCodeList(lines[j]);

          if (!found) break;

          codes.push(...found);
          j++;
        }

        if (codes.length) {
          out.push(
            header === "บนล่าง"
              ? "บนล่าง"
              : header
          );
          out.push(
            `${codes.join(" ")}=${prefixCollective[2]}`
          );
          i = j - 1;
          continue;
        }
      }
    }

    // --------------------------------------------------------
    // Suffix collective:
    //
    // 23
    // 32
    // 38
    // 83
    // ตัวละ 500 บนล่าง
    // --------------------------------------------------------
    const collective =
      parseSafeCollectiveQuantityLine(line);

    if (collective) {
      if (collective.direction) {
        const codes = [];

        while (out.length) {
          const candidate =
            String(out[out.length - 1] || "").trim();

          const found =
            extractSafeTwoDigitCodeList(candidate);

          if (!found) break;

          codes.unshift(...found);
          out.pop();
        }

        if (codes.length) {
          out.push(
            collective.direction === "บนล่าง"
              ? "บนล่าง"
              : collective.direction
          );
          out.push(
            `${codes.join(" ")}=${collective.quantity}`
          );
          continue;
        }
      }

      // ------------------------------------------------------
      // Explicit directional blocks closed by one final
      // "ตัวละ":
      //
      // บน
      // 19
      // 91
      // ล่าง
      // 19
      // 91
      // ตัวละ50
      // ------------------------------------------------------
      if (!collective.direction) {
        // Ignore blank separators immediately before "ตัวละ".
        // Real LINE messages commonly separate the order block from
        // its final collective quantity with one or more blank lines.
        let end = out.length;

        while (
          end > 0 &&
          !String(out[end - 1] || "").trim()
        ) {
          end--;
        }

        let start = end;

        while (start > 0) {
          const candidate =
            String(out[start - 1] || "").trim();

          if (
            directionHeader(candidate) ||
            extractSafeTwoDigitCodeList(candidate)
          ) {
            start--;
            continue;
          }

          break;
        }

        const candidateBlock =
          out.slice(start, end);

        const normalizedBlocks =
          emitDirectionalBlocks(
            candidateBlock,
            collective.quantity
          );

        if (normalizedBlocks) {
          out.splice(
            start,
            out.length - start,
            ...normalizedBlocks
          );
          continue;
        }
      }
    }

    out.push(original);
  }

  return out.join("\n");
}

function isSafeChatMetadataLine(line) {
  const raw = String(line || "").trim();

  if (!raw) return true;

  // LINE chat summaries may be decorated with a flag/emoji:
  //
  //   🇱🇦รวม 60
  //
  // Strip only leading non-letter/non-digit decoration for summary
  // recognition. Do not alter the actual parser input or ordinary
  // sender/name text such as 🇱🇦ดอม1080.
  const summaryText = raw
    .replace(/^[^\p{L}\p{M}\d=]+/u, "")
    .trimStart();

  // Never classify lines containing known order operators/context as
  // metadata merely because they also contain currency.
  if (
    /(?:รูด|เบิ้ล|บน|ล่าง|บลก?|โต๊ด|โต้ด|ตรง|กลับ|ประตู|ปะตู|วิ่ง)/u.test(raw)
  ) {
    return false;
  }

  // Bare monetary total:
  // 310฿
  // 1400 บาท
  // 200.-
  // (280.)
  if (
    /^\(?\s*[\d,]+(?:\.\d+)?\s*(?:฿|บาท|\.-|\.)\s*\)?(?:\s*[🇱🇦]*)?$/u.test(raw)
  ) {
    return true;
  }

  // Currency-first name metadata:
  //
  // 2,400฿🇱🇦🇱🇦 พี่แอ๋ม
  //
  // Keep this deliberately narrow:
  // - explicit currency marker is required
  // - symbols/emoji may occur before the name
  // - the suffix must be a name-like letter sequence
  // - '=' is forbidden
  //
  // Known order keywords such as บน/ล่าง/โต๊ด/รูด are
  // rejected by the guard above before reaching this rule.
  if (
    /^[\d,]+(?:\.\d+)?\s*(?:฿|บาท|\.-)(?:[^\p{L}\p{M}\d=]*)(?=\p{L})[\p{L}\p{M}\s._-]+$/u.test(raw)
  ) {
    return true;
  }

  // Name + monetary total:
  // นุ้ย 80.-🇱🇦
  // อีฟQC 320฿
  // พี่อีฟเบญ🇱🇦120฿
  if (
    /^(?=.*[\p{L}])[^=]*[\d,]+(?:\.\d+)?\s*(?:฿|บาท|\.-)(?:\s*[🇱🇦]*)?$/u.test(raw)
  ) {
    return true;
  }

  // Explicit operational totals:
  // ยอด20
  // รวม 90
  // รวม 400฿ พี่เมล์
  if (
    /^(?:ยอด|รวม)\s*[\d,]+(?:\.\d+)?(?:\s*(?:฿|บาท|\.-))?(?:\s+.*)?$/u.test(summaryText)
  ) {
    return true;
  }

  return false;
}

function stripPoliteWords(text) {
  return text
    .replace(/\b(please)\b/gi, " ")
    .replace(/(ค่ะ|ครับ|คะ|จ้า|จ้ะ|นะคะ|นะครับ)\s*$/giu, "")
    .trim();
}

function normalizeLatin(text) {
  return text.replace(/[a-z]+/g, m => m.toUpperCase());
}

function resolveAlias(token, cfg) {
  if (!token) return null;
  const raw = String(token).trim();
  const upper = normalizeLatin(raw);
  return cfg.aliases[raw] || cfg.aliases[upper] || null;
}

function reverseCode(code) {
  return code.split("").reverse().join("");
}

function uniquePermutations(code) {
  const chars = code.split("");
  const out = new Set();

  function walk(prefix, remaining) {
    if (remaining.length === 0) {
      out.add(prefix);
      return;
    }
    const used = new Set();
    for (let i = 0; i < remaining.length; i++) {
      if (used.has(remaining[i])) continue;
      used.add(remaining[i]);
      const next = remaining.slice(0, i).concat(remaining.slice(i + 1));
      walk(prefix + remaining[i], next);
    }
  }

  walk("", chars);
  return [...out].sort();
}

function makeAccumulator() {
  const map = new Map();
  return {
    add(category, code, quantity) {
      const qty = Number(quantity);
      if (!category || !code || !Number.isFinite(qty) || qty <= 0) return;
      const key = `${category}|${code}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += qty;
      } else {
        map.set(key, { category, code: String(code), quantity: qty });
      }
    },
    values() {
      return [...map.values()].sort((a, b) =>
        a.category.localeCompare(b.category) ||
        a.code.localeCompare(b.code, "en", { numeric: true })
      );
    }
  };
}

function dedupeCodes(codes) {
  return [...new Set(codes)];
}

function emitTwoDigitGroup(acc, codes, quantitySpec, modifier, options = {}) {
  let finalCodes = dedupeCodes(codes);
  if (modifier.reverse) {
    finalCodes = dedupeCodes(finalCodes.concat(finalCodes.map(reverseCode)));
  }
  if (options.excludeDoubles) {
    finalCodes = finalCodes.filter((code) => !(code.length === 2 && code[0] === code[1]));
  }

  const categories = modifier.categories;
  if (quantitySpec.type === "PAIR") {
    if (!categories || categories.length === 0) {
      for (const code of finalCodes) {
        acc.add("A", code, quantitySpec.first);
        acc.add("B", code, quantitySpec.second);
      }
      return;
    }

    if (categories.includes("A")) {
      for (const code of finalCodes) acc.add("A", code, quantitySpec.first);
    }
    if (categories.includes("B")) {
      for (const code of finalCodes) acc.add("B", code, quantitySpec.second);
    }
    return;
  }

  const cats = categories && categories.length ? categories : ["A"];
  for (const category of cats) {
    for (const code of finalCodes) acc.add(category, code, quantitySpec.first);
  }
}

function mergeModifiers(...mods) {
  const categories = [];
  let reverse = false;
  for (const mod of mods) {
    if (!mod) continue;
    for (const category of mod.categories || []) {
      if (!categories.includes(category)) categories.push(category);
    }
    reverse = reverse || Boolean(mod.reverse);
  }
  return { categories, reverse };
}

function modifierFromToken(token, cfg) {
  const raw = String(token || "").trim();
  const t = normalizeLatin(raw);
  if (t === "ABC") return { categories: ["A", "B"], reverse: true };
  if (t === "AB") return { categories: ["A", "B"], reverse: false };
  if (t === "A") return { categories: ["A"], reverse: false };
  if (t === "B") return { categories: ["B"], reverse: false };
  if (t === "C") return { categories: [], reverse: true };

  const resolved = resolveAlias(raw, cfg);
  if (resolved === "ABC") return { categories: ["A", "B"], reverse: true };
  if (resolved === "AB") return { categories: ["A", "B"], reverse: false };
  if (resolved === "A") return { categories: ["A"], reverse: false };
  if (resolved === "B") return { categories: ["B"], reverse: false };
  if (resolved === "C") return { categories: [], reverse: true };

  // Allow the reverse alias to be attached to a canonical A/B modifier,
  // e.g. ABกลับ / Aกลับ / กลับAB. This keeps fast chat input compact.
  const reverseAliases = Object.entries(cfg.aliases || {})
    .filter(([alias, target]) => target === "C" && normalizeLatin(alias) !== "C")
    .map(([alias]) => alias)
    .sort((a, b) => b.length - a.length);
  for (const alias of reverseAliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const suffix = raw.match(new RegExp(`^(ABC|AB|A|B)${escaped}$`, "iu"));
    if (suffix) return mergeModifiers(modifierFromToken(suffix[1], cfg), { categories: [], reverse: true });
    const prefix = raw.match(new RegExp(`^${escaped}(ABC|AB|A|B)$`, "iu"));
    if (prefix) return mergeModifiers({ categories: [], reverse: true }, modifierFromToken(prefix[1], cfg));
  }
  return null;
}

function modifierFromExpression(text, cfg) {
  const tokens = String(text || "").trim().split(/\s+/).filter(Boolean);
  let modifier = null;
  let matched = 0;
  for (const token of tokens) {
    const mod = modifierFromToken(token, cfg);
    if (!mod) return null;
    modifier = mergeModifiers(modifier, mod);
    matched += 1;
  }
  return matched ? modifier : null;
}

function findInlineModifier(line, cfg) {
  const raw = String(line || "");

  // Attached category/alias before a 2-digit code, e.g. A01=20 / น01=20.
  const attached = raw.match(/^([^\d\s=]+)(?=\d{2}(?:\D|$))/u);
  if (attached) {
    const modifier = modifierFromToken(attached[1], cfg);
    if (modifier && (modifier.categories || []).every((x) => ["A", "B"].includes(x))) {
      return { tokens: [], prefix: attached[1], modifier, attached: true };
    }
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  const found = [];
  let modifier = null;
  for (const token of tokens) {
    const mod = modifierFromToken(token, cfg);
    if (!mod) continue;
    found.push(token);
    modifier = mergeModifiers(modifier, mod);
  }
  return modifier ? { tokens: found, modifier, attached: false } : null;
}

function removeModifierToken(line, found) {
  if (!found) return line;
  if (found.attached) return line.slice(found.prefix.length);
  const remove = new Set(found.tokens || []);
  return line.split(/\s+/).filter((token) => !remove.has(token)).join(" ").trim();
}

function parseOneDigitLine(line, cfg, acc, rules) {
  const t = stripPoliteWords(normalizeLatin(line.trim()));
  if (!t) return false;

  // Direct canonical form: H1=500 / L2=300 / H 1 3 5=500.
  let m = t.match(/^([HL])\s*([0-9](?:[\s,/:.]+[0-9])*)\s*=\s*(\d+)$/iu);
  if (m) {
    const category = m[1].toUpperCase();
    const codes = dedupeCodes(m[2].split(/[\s,/:.]+/u).filter(Boolean));
    for (const code of codes) acc.add(category, code, Number(m[3]));
    rules.add(`R_1DIGIT_CATEGORY_${category}`);
    return true;
  }

  // Natural operational aliases. Longest alias wins so "วิ่งบน" is resolved
  // before a shorter legacy alias such as "บ".
  const aliases = Object.entries(cfg.aliases || {})
    .filter(([, target]) => target === "H" || target === "L")
    .map(([alias, target]) => ({ alias, target }))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { alias, target } of aliases) {
    const escaped = alias.split(/\s+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
    const match = t.match(new RegExp(`^${escaped}\\s*([0-9](?:[\\s,/:.]+[0-9])*)\\s*=\\s*(\\d+)$`, "iu"));
    if (!match) continue;
    const codes = dedupeCodes(match[1].split(/[\s,/:.]+/u).filter(Boolean));
    for (const code of codes) acc.add(target, code, Number(match[2]));
    rules.add(`R_1DIGIT_ALIAS_${target}`);
    return true;
  }

  return false;
}

function resolveThreeDigitCategory(token, cfg) {
  const raw = String(token || "").trim();
  if (!raw) return null;
  const upper = normalizeLatin(raw);
  if (["A", "B", "E", "F", "G"].includes(upper)) return upper;
  const resolved = resolveAlias(raw, cfg);
  return ["A", "B", "E", "F", "G"].includes(resolved) ? resolved : null;
}

function aliasesForTarget(cfg, target) {
  return Object.entries(cfg.aliases || {})
    .filter(([, value]) => value === target)
    .map(([alias]) => alias)
    .sort((a, b) => b.length - a.length);
}

function contextualDirectionFromToken(token) {
  const raw = String(token || "").trim();
  if (raw === "บน" || raw === "บ") return "TOP";
  if (raw === "ล่าง" || raw === "ล") return "BOTTOM";
  return null;
}

// Domain-scoped 3-digit vocabulary.
//
// Do not put these words into the global category alias table:
// their meaning belongs specifically to 3-digit order grammar.
//
// DIRECT  => canonical E (เต็ง/ตรง)
// TOD     => canonical F (โต๊ด/โต้ด)
// PERMUTE => all unique permutations (กลับ/ประตู/ปะตู/ปต)
function resolveThreeDigitVocabulary(token) {
  const raw = String(token || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!raw) return null;

  if (/^(?:เต็ง|ตรง)$/u.test(raw)) return "DIRECT";
  if (/^(?:โต๊ด|โต้ด)$/u.test(raw)) return "TOD";
  if (/^(?:กลับ|ประตู|ปะตู|ปต)$/u.test(raw)) return "PERMUTE";

  return null;
}


// A standalone 3-digit vocabulary header applies only when the next
// non-blank line is unmistakably a 3-digit '=' assignment.
//
// Example:
//
//   โต๊ด
//   123=20
//
// becomes:
//
//   123=20 โต๊ด
//
// This is deliberately code-width scoped. Therefore:
//
//   กลับ
//   01=20
//
// is NOT rewritten as a 3-digit command.
function normalizeThreeDigitVocabularyHeaders(text) {
  const lines = String(text || "").split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] || "");
    const header = raw.trim();

    if (!resolveThreeDigitVocabulary(header)) {
      out.push(raw);
      continue;
    }

    let j = i + 1;

    while (
      j < lines.length &&
      !String(lines[j] || "").trim()
    ) {
      j++;
    }

    if (j >= lines.length) {
      out.push(raw);
      continue;
    }

    const candidate =
      String(lines[j] || "").trim();

    const clearThreeDigitAssignment =
      /^\d{3}(?:[\s,/:.]+\d{3})*\s*=\s*\d+$/u.test(
        candidate
      );

    if (!clearThreeDigitAssignment) {
      out.push(raw);
      continue;
    }

    out.push(`${candidate} ${header}`);
    i = j;
  }

  return out.join("\n");
}


function directionModifier(direction) {
  if (direction === "TOP") return { categories: ["A"], reverse: false };
  if (direction === "BOTTOM") return { categories: ["B"], reverse: false };
  return null;
}

function stripTrailingContextualDirection(text) {
  const raw = String(text || "").trim();
  if (!raw) return { text: raw, direction: null };

  // Whitespace form: "20 บน", "20 ล", "20*30 บ".
  let m = raw.match(/^(.*?)(?:\s+)(บน|บ|ล่าง|ล)\s*$/u);
  if (m) return { text: m[1].trim(), direction: contextualDirectionFromToken(m[2]) };

  // Compact quantity form: "20บน" / "20ล". Require a digit immediately
  // before the keyword so words such as "บลก" are never split accidentally.
  m = raw.match(/^(.*\d)(บน|บ|ล่าง|ล)\s*$/u);
  if (m) return { text: m[1].trim(), direction: contextualDirectionFromToken(m[2]) };

  return { text: raw, direction: null };
}

function stripLeadingContextualDirection(text) {
  const raw = String(text || "").trim();
  if (!raw) return { text: raw, direction: null };
  const m = raw.match(/^(บน|บ|ล่าง|ล)(?=\s|\d|$)\s*/u);
  if (!m) return { text: raw, direction: null };
  return {
    text: raw.slice(m[0].length).trim(),
    direction: contextualDirectionFromToken(m[1])
  };
}

function mergeContextualDirections(first, second) {
  if (!first) return { direction: second || null, conflict: false };
  if (!second) return { direction: first, conflict: false };
  return { direction: first, conflict: first !== second };
}

function parseQuantityExpression(expr) {
  // Commas are thousands separators only after a token has already been
  // isolated as a quantity expression. Never normalize commas globally,
  // because code lists may legitimately use commas as separators.
  const s = String(expr || "")
    .trim()
    .replace(/,/g, "");
  let m = s.match(/^(\d+)\s*[xX*]\s*(\d+)$/);
  if (m) return { type: "PAIR", first: Number(m[1]), second: Number(m[2]), delimiter: m[0].includes("*") ? "*" : "x" };

  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return { type: "PAIR", first: Number(m[1]), second: Number(m[2]), delimiter: "/" };

  m = s.match(/^(\d+)$/);
  if (m) return { type: "SINGLE", first: Number(m[1]), second: null, delimiter: null };

  return null;
}

function extractTwoDigitCodes(text) {
  const normalized = text
    .replace(/[\/:\-]/g, " ")
    .replace(/[^0-9\s]/g, " ");
  return normalized
    .split(/\s+/)
    .filter(x => /^\d{2}$/.test(x));
}

function isMetadataLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (isStandaloneDateMetadataLine(t)) return true;

  // Name/date metadata, e.g. แป้ง 21-8-69 / ลาว 26/8/69.
  // Validate a plausible day/month so ordinary slash-separated order syntax
  // is not silently treated as metadata.
  const thaiDate = /\b(?:0?[1-9]|[12]\d|3[01])([/-])(?:0?[1-9]|1[0-2])\1(?:\d{2}|\d{4})\b/;
  if (/[\u0E00-\u0E7F]/u.test(t) && thaiDate.test(t)) return true;
  // common chat-only short acknowledgements
  if (/^(ขอบคุณ|ขอบคุณค่ะ|ขอบคุณครับ|รับทราบ|โอเค|ok)$/iu.test(t)) return true;
  return false;
}


function isPermuteAllCommand(text, cfg) {
  let raw = String(text || "").trim().replace(/\s+/g, " ");
  if (!raw) return false;

  // In 3-digit grammar a standalone * is shorthand for "ทุกกลับ".
  // It must not affect 2-digit quantity-pair parsing.
  let sawStar = false;
  raw = raw.replace(/\*/g, () => {
    sawStar = true;
    return " ";
  }).replace(/\s+/g, " ").trim();

  if (!raw) return sawStar;
  return resolveAlias(raw, cfg) === "PERMUTE_ALL";
}

function isThreeDigitPermuteMarker(text, cfg) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (isPermuteAllCommand(raw, cfg)) return true;
  // In 3-digit chat grammar the existing reverse alias (e.g. ก -> C)
  // means "กลับทุกตำแหน่ง" / permutation. This is context-specific;
  // the same alias remains the 2-digit reverse modifier elsewhere.
  return resolveAlias(raw, cfg) === "C" || normalizeLatin(raw) === "C";
}

function splitTwoDigitCodeList(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const parts = raw.split(/[\s,/:.]+/u).filter(Boolean);
  if (!parts.length || parts.some((part) => !/^\d{2}$/.test(part))) return null;
  const residue = raw.replace(/\d{2}/g, "").replace(/[\s,/:.]/g, "");
  return residue ? null : parts;
}

function splitThreeDigitCodeList(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const parts = raw.split(/[\s,/:.]+/u).filter(Boolean);
  if (!parts.length || parts.some((part) => !/^\d{3}$/.test(part))) return null;
  const residue = raw.replace(/\d{3}/g, "").replace(/[\s,/:.]/g, "");
  return residue ? null : parts;
}

function coalesceThreeDigitLines(lines) {
  const out = [];
  let pendingCodes = [];

  const flushPending = () => {
    if (!pendingCodes.length) return;
    out.push(pendingCodes.join(" "));
    pendingCodes = [];
  };

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) continue;

    const codesOnly = splitThreeDigitCodeList(line);
    if (codesOnly) {
      pendingCodes.push(...codesOnly);
      continue;
    }

    if (pendingCodes.length && /^=/u.test(line)) {
      out.push(`${pendingCodes.join(" ")}${line}`);
      pendingCodes = [];
      continue;
    }

    // Standalone E/F quantity pair after exactly one pending 3-digit code:
    //
    // 778
    // 100*100
    //
    // => 778=100*100
    //
    // Keep this intentionally narrow:
    // - exactly one pending 3-digit code
    // - exactly two numeric quantities
    // - x/X/*/× delimiter
    //
    // Multiple pending 3-digit codes remain Review-safe because a bare
    // quantity pair does not provide enough evidence that it applies to
    // every preceding code.
    if (pendingCodes.length === 1) {
      const standalonePair = line.match(
        /^((?:\d{1,3}(?:,\d{3})+|\d+)\s*[xX*×]\s*(?:\d{1,3}(?:,\d{3})+|\d+))$/u
      );

      if (standalonePair) {
        out.push(
          `${pendingCodes.join(" ")}=${standalonePair[1]}`
        );
        pendingCodes = [];
        continue;
      }
    }

    // Natural pending form:
    // 396\n394\n364\n964-10*10
    // means the four 3-digit codes share the final quantity expression.
    if (pendingCodes.length) {
      const finalWithDashQty = line.match(/^(\d{3})\s*-\s*(\d+(?:\s*[xX*\/]\s*\d+)?(?:\s+.+)?)$/u);
      if (finalWithDashQty) {
        out.push(`${pendingCodes.concat(finalWithDashQty[1]).join(" ")}=${finalWithDashQty[2].trim()}`);
        pendingCodes = [];
        continue;
      }
    }

    flushPending();
    out.push(line);
  }

  flushPending();
  return out;
}

function threeDigitDestinationCategory(prefix) {
  if (prefix === "B" || prefix === "G") return "G";
  if (prefix === "F") return "F";
  return "E"; // no prefix, A, or E
}

function emitThreeDigitPermutations(acc, codes, quantity, category) {
  const generated = new Set();
  for (const code of codes) {
    for (const permutation of uniquePermutations(code)) generated.add(permutation);
  }
  for (const code of [...generated].sort()) acc.add(category, code, quantity);
  return generated.size;
}

function parseThreeDigitRhs(right, cfg) {
  const raw = String(right || "").trim();

  // Explicit permutation count + reverse marker, including multiple source codes:
  // 397 349 796=50*6 ก  => each source must have 6 unique permutations at 50 each.
  // The marker disambiguates this from the ordinary E/F quantity pair grammar.
  let m = raw.match(/^(\d+)\s*[xX*]\s*([136])\s*(.+)$/u);
  if (m && isThreeDigitPermuteMarker(m[3], cfg)) {
    return { kind: "COUNTED_PERMUTE", quantity: Number(m[1]), statedCount: Number(m[2]) };
  }

  // Repeated equal quantities are another spelling of "ทุกกลับ / ประตู".
  // Example: 998=100x100x100 => 3 unique permutations at 100 each.
  //          093=100x100x100x100x100x100 => 6 unique permutations at 100 each.
  // This is intentionally different from the existing TWO-value E/F pair
  // grammar such as 920=500x500.
  m = raw.match(/^\d+(?:\s*[xX]\s*\d+){2,5}$/u);
  if (m) {
    const values = raw.split(/\s*[xX]\s*/u).map(Number);
    const first = values[0];
    if (values.every((value) => value === first)) {
      return { kind: "REPEATED_PERMUTE", quantity: first, statedCount: values.length };
    }
    return { kind: "INVALID_REPEATED_QUANTITIES", values };
  }

  // v7.2 briefly accepted x* inside a quantity chain. That interpretation was
  // based on incorrect business input and is deliberately rejected now.
  if (/^\d+\s*[xX]\s*\d+\s*[xX]\s*\*\s*\d+$/u.test(raw)) {
    return { kind: "INVALID_XSTAR_PERMUTATION" };
  }

  // Natural language / compact command, e.g.
  // 093 998 = 100 * ทุกกลับ
  // 998 = 100 3ปต
  // 093 = 100 6 ประตู
  m = raw.match(/^(\d+)\s+(.+)$/u);
  if (m) {
    const vocabulary =
      resolveThreeDigitVocabulary(m[2]);

    if (vocabulary === "DIRECT") {
      return {
        kind: "VOCAB_CATEGORY",
        category: "E",
        quantity: Number(m[1]),
      };
    }

    if (vocabulary === "TOD") {
      return {
        kind: "VOCAB_CATEGORY",
        category: "F",
        quantity: Number(m[1]),
      };
    }

    if (vocabulary === "PERMUTE") {
      return {
        kind: "PERMUTE_ALL",
        quantity: Number(m[1]),
      };
    }

    if (isPermuteAllCommand(m[2], cfg)) {
      return { kind: "PERMUTE_ALL", quantity: Number(m[1]) };
    }
  }

  // Also allow a compact star immediately after the quantity: 998=100*ทุกกลับ
  m = raw.match(/^(\d+)\s*(\*.+)$/u);
  if (m && isPermuteAllCommand(m[2], cfg)) {
    return { kind: "PERMUTE_ALL", quantity: Number(m[1]) };
  }

  const quantitySpec = parseQuantityExpression(raw);
  return quantitySpec ? { kind: "QUANTITY", quantitySpec } : null;
}

function parseThreeDigitLine(line, cfg, acc, rules, errors) {
  const t = stripPoliteWords(normalizeLatin(line.trim()));

  // High-confidence natural space assignment:
  //
  // 220 10
  // 202 10
  // 022 10
  //
  // A 3-digit code followed by a 1-2 digit SINGLE quantity is
  // unambiguous in the current grammar. Keep pair expressions
  // such as "249 5*5" outside this rule so permutation semantics
  // remain Review-safe.
  const naturalSingle = t.match(/^(\d{3})\s+(\d{1,2})$/u);

  if (naturalSingle) {
    acc.add("E", naturalSingle[1], Number(naturalSingle[2]));
    rules.add("R_3DIGIT_NATURAL_SPACE_SINGLE");
    return true;
  }

  // High-confidence natural E/F pair without '=':
  //
  // 086 20*20 => E086=20, F086=20
  //
  // Keep q2 <= 6 Review-safe because in the existing 3-digit
  // grammar that range can represent a permutation count:
  //
  // 249 5*5
  // 123 20*6
  //
  // Without an explicit '=' or permutation marker we must not guess.
  const naturalPair = t.match(
    /^(\d{3})\s+(\d+)\s*[xX*\/]\s*(\d+)$/u
  );

  if (naturalPair) {
    const code = naturalPair[1];
    const first = Number(naturalPair[2]);
    const second = Number(naturalPair[3]);

    if (second <= 6) {
      errors.push({
        code: "AMBIGUOUS_3DIGIT_NATURAL_PAIR",
        detail:
          `${line} — ค่าตัวที่สอง ${second} อาจเป็นจำนวน permutation`,
      });

      rules.add("R_3DIGIT_NATURAL_SPACE_PAIR_AMBIGUOUS");
      return true;
    }

    acc.add("E", code, first);
    acc.add("F", code, second);

    rules.add("R_3DIGIT_NATURAL_SPACE_EF_PAIR");
    return true;
  }

  // Natural 3-digit category suffix, e.g. "639 100 โต๊ด" => F639=100.
  // TOP/BOTTOM are contextual: บน/บ => E for 3 digits, ล่าง/ล => G.
  let natural = t.match(/^(\d{3})\s+(\d+)\s+(.+)$/u);
  if (natural) {
    const vocabulary =
      resolveThreeDigitVocabulary(natural[3]);

    if (vocabulary === "DIRECT") {
      acc.add("E", natural[1], Number(natural[2]));
      rules.add("R_3DIGIT_VOCAB_DIRECT");
      return true;
    }

    if (vocabulary === "TOD") {
      acc.add("F", natural[1], Number(natural[2]));
      rules.add("R_3DIGIT_VOCAB_TOD");
      return true;
    }

    if (vocabulary === "PERMUTE") {
      emitThreeDigitPermutations(
        acc,
        [natural[1]],
        Number(natural[2]),
        "E"
      );
      rules.add("R_3DIGIT_VOCAB_PERMUTE");
      return true;
    }

    const direction = contextualDirectionFromToken(natural[3]);
    if (direction) {
      const category = direction === "TOP" ? "E" : "G";
      acc.add(category, natural[1], Number(natural[2]));
      rules.add(`R_3DIGIT_CONTEXT_${direction}`);
      return true;
    }

    const category = resolveThreeDigitCategory(natural[3], cfg);
    if (["E", "F", "G"].includes(category)) {
      acc.add(category, natural[1], Number(natural[2]));
      rules.add(`R_3DIGIT_NATURAL_CATEGORY_${category}`);
      return true;
    }
  }

  // Natural permutation marker between code(s) and quantity:
  // "812 หกกลับ 20" / "812 6กลับ 20".
  natural = t.match(/^(\d{3}(?:[\s,/:.]+\d{3})*)\s+(.+?)\s+(\d+)$/u);
  if (natural) {
    const codes =
      dedupeCodes(
        natural[1]
          .split(/[\s,/:.]+/u)
          .filter(Boolean)
      );

    const vocabulary =
      resolveThreeDigitVocabulary(natural[2]);

    if (vocabulary === "DIRECT") {
      for (const code of codes) {
        acc.add("E", code, Number(natural[3]));
      }
      rules.add("R_3DIGIT_VOCAB_DIRECT");
      return true;
    }

    if (vocabulary === "TOD") {
      for (const code of codes) {
        acc.add("F", code, Number(natural[3]));
      }
      rules.add("R_3DIGIT_VOCAB_TOD");
      return true;
    }

    if (
      vocabulary === "PERMUTE" ||
      isThreeDigitPermuteMarker(natural[2], cfg)
    ) {
      emitThreeDigitPermutations(
        acc,
        codes,
        Number(natural[3]),
        "E"
      );

      rules.add(
        vocabulary === "PERMUTE"
          ? "R_3DIGIT_VOCAB_PERMUTE"
          : "R_3DIGIT_NATURAL_PERMUTE"
      );

      return true;
    }
  }

  const eqIndex = t.indexOf("=");
  if (eqIndex < 0 || t.indexOf("=", eqIndex + 1) >= 0) return false;

  let left = t.slice(0, eqIndex).trim();
  let right = t.slice(eqIndex + 1).trim();

  // บน/บ and ล่าง/ล are contextual keywords, not global category aliases.
  // They can be written before the 3-digit codes or after the quantity.
  const leftDirection = stripLeadingContextualDirection(left);
  left = leftDirection.text;
  const rightDirection = stripTrailingContextualDirection(right);
  right = rightDirection.text;
  const contextual = mergeContextualDirections(leftDirection.direction, rightDirection.direction);
  if (contextual.conflict) {
    errors.push({ code: "CONTEXT_DIRECTION_CONFLICT", detail: line });
    rules.add("R_3DIGIT_CONTEXT_CONFLICT");
    return true;
  }
  const contextualDirection = contextual.direction;

  // Optional explicit suffix: 653=20(F) or alias equivalent.
  let explicitCategory = null;
  const suffix = right.match(/^(.*?)\(\s*([^()]+?)\s*\)\s*$/u);
  if (suffix) {
    explicitCategory = resolveThreeDigitCategory(suffix[2], cfg);
    if (!explicitCategory || !["E", "F", "G"].includes(explicitCategory)) return false;
    right = suffix[1].trim();
  }

  const rhs = parseThreeDigitRhs(right, cfg);
  if (!rhs) return false;

  const firstDigit = left.search(/\d/);
  if (firstDigit < 0) return false;
  const prefixText = left.slice(0, firstDigit).trim();
  const codeText = left.slice(firstDigit).trim();
  const codeParts = codeText.split(/[\s,/:.]+/).filter(Boolean);
  if (!codeParts.length || codeParts.some((code) => !/^\d{3}$/.test(code))) return false;
  const residue = codeText.replace(/\d{3}/g, "").replace(/[\s,/:.]/g, "");
  if (residue) return false;
  const codes = dedupeCodes(codeParts);

  const prefix = prefixText ? resolveThreeDigitCategory(prefixText, cfg) : null;
  if (prefixText && !prefix) return false;

  if (contextualDirection && explicitCategory) {
    errors.push({ code: "CONTEXT_CATEGORY_CONFLICT", detail: line });
    rules.add("R_3DIGIT_CONTEXT_CONFLICT");
    return true;
  }
  if (contextualDirection === "TOP" && prefix && !["A", "E"].includes(prefix)) {
    errors.push({ code: "CONTEXT_CATEGORY_CONFLICT", detail: line });
    rules.add("R_3DIGIT_CONTEXT_CONFLICT");
    return true;
  }
  if (contextualDirection === "BOTTOM" && prefix && !["B", "G"].includes(prefix)) {
    errors.push({ code: "CONTEXT_CATEGORY_CONFLICT", detail: line });
    rules.add("R_3DIGIT_CONTEXT_CONFLICT");
    return true;
  }

  if (rhs.kind === "VOCAB_CATEGORY") {
    // Vocabulary category is already explicit. Do not combine it with
    // another explicit category/direction/prefix because that would make
    // the destination ambiguous.
    if (
      explicitCategory ||
      contextualDirection ||
      prefix
    ) {
      errors.push({
        code: "CONTEXT_CATEGORY_CONFLICT",
        detail: line,
      });
      rules.add("R_3DIGIT_CONTEXT_CONFLICT");
      return true;
    }

    for (const code of codes) {
      acc.add(
        rhs.category,
        code,
        rhs.quantity
      );
    }

    rules.add(
      rhs.category === "F"
        ? "R_3DIGIT_VOCAB_TOD"
        : "R_3DIGIT_VOCAB_DIRECT"
    );

    return true;
  }

  if (rhs.kind === "COUNTED_PERMUTE") {
    if (explicitCategory) {
      errors.push({ code: "UNSUPPORTED_EXPLICIT_CATEGORY_PERMUTATION", detail: line });
      rules.add("R_3DIGIT_COUNTED_PERMUTE");
      return true;
    }

    const mismatches = codes
      .map((code) => ({ code, actual: uniquePermutations(code).length }))
      .filter((entry) => entry.actual !== rhs.statedCount);
    if (mismatches.length) {
      errors.push({
        code: "PERMUTATION_COUNT_MISMATCH",
        detail: mismatches.map((entry) => `${entry.code} มี unique permutations ${entry.actual} แบบ แต่ระบุ *${rhs.statedCount}`).join("; ")
      });
      rules.add("R_3DIGIT_COUNTED_PERMUTE");
      return true;
    }

    const category = contextualDirection === "BOTTOM" ? "G" : threeDigitDestinationCategory(prefix);
    emitThreeDigitPermutations(acc, codes, rhs.quantity, category);
    if (contextualDirection) rules.add(`R_3DIGIT_CONTEXT_${contextualDirection}`);
    rules.add("R_3DIGIT_COUNTED_PERMUTE");
    return true;
  }

  if (rhs.kind === "PERMUTE_ALL") {
    if (explicitCategory) {
      errors.push({ code: "UNSUPPORTED_EXPLICIT_CATEGORY_PERMUTATION", detail: line });
      rules.add("R_3DIGIT_PERMUTE_ALL");
      return true;
    }
    const category = contextualDirection === "BOTTOM" ? "G" : threeDigitDestinationCategory(prefix);
    emitThreeDigitPermutations(acc, codes, rhs.quantity, category);
    if (contextualDirection) rules.add(`R_3DIGIT_CONTEXT_${contextualDirection}`);
    rules.add("R_3DIGIT_PERMUTE_ALL");
    return true;
  }

  if (rhs.kind === "INVALID_XSTAR_PERMUTATION") {
    errors.push({
      code: "INVALID_XSTAR_PERMUTATION",
      detail: `${line} — ใช้รูปแบบจำนวนซ้ำ เช่น 998=100x100x100`
    });
    rules.add("R_3DIGIT_REPEATED_PERMUTATION");
    return true;
  }

  if (rhs.kind === "INVALID_REPEATED_QUANTITIES") {
    errors.push({
      code: "REPEATED_PERMUTATION_QUANTITY_MISMATCH",
      detail: `${line} — จำนวนแต่ละประตูต้องเท่ากัน`
    });
    rules.add("R_3DIGIT_REPEATED_PERMUTATION");
    return true;
  }

  if (rhs.kind === "REPEATED_PERMUTE") {
    if (explicitCategory || codes.length !== 1) {
      errors.push({ code: "UNSUPPORTED_REPEATED_PERMUTATION", detail: line });
      rules.add("R_3DIGIT_REPEATED_PERMUTATION");
      return true;
    }
    const code = codes[0];
    const perms = uniquePermutations(code);
    if (perms.length !== rhs.statedCount) {
      errors.push({
        code: "PERMUTATION_COUNT_MISMATCH",
        detail: `${code} มี unique permutations ${perms.length} แบบ แต่ระบุจำนวนซ้ำ ${rhs.statedCount} ค่า`
      });
      rules.add("R_3DIGIT_REPEATED_PERMUTATION");
      return true;
    }
    const category = contextualDirection === "BOTTOM" ? "G" : threeDigitDestinationCategory(prefix);
    for (const permutation of perms) acc.add(category, permutation, rhs.quantity);
    if (contextualDirection) rules.add(`R_3DIGIT_CONTEXT_${contextualDirection}`);
    rules.add("R_3DIGIT_REPEATED_PERMUTATION");
    return true;
  }

  const quantitySpec = rhs.quantitySpec;

  if (contextualDirection === "TOP") {
    if (quantitySpec.type === "SINGLE") {
      for (const code of codes) acc.add("E", code, quantitySpec.first);
      rules.add("R_3DIGIT_CONTEXT_TOP");
      return true;
    }
    // In 3-digit TOP context a pair means ตรง/โต๊ด: first => E, second => F.
    for (const code of codes) {
      acc.add("E", code, quantitySpec.first);
      acc.add("F", code, quantitySpec.second);
    }
    rules.add("R_3DIGIT_CONTEXT_TOP_EF_PAIR");
    return true;
  }

  if (contextualDirection === "BOTTOM") {
    // Historical 3-digit B/G behavior: G uses the first quantity. If a pair is
    // typed, the second value is intentionally not mapped to another category.
    for (const code of codes) acc.add("G", code, quantitySpec.first);
    rules.add(quantitySpec.type === "PAIR" ? "R_3DIGIT_CONTEXT_BOTTOM_PAIR_TO_G" : "R_3DIGIT_CONTEXT_BOTTOM");
    return true;
  }

  if (explicitCategory) {
    if (quantitySpec.type !== "SINGLE") {
      errors.push({ code: "UNSUPPORTED_EXPLICIT_CATEGORY_PAIR", detail: line });
      rules.add("R_3DIGIT_EXPLICIT_CATEGORY");
      return true;
    }
    for (const code of codes) acc.add(explicitCategory, code, quantitySpec.first);
    rules.add("R_3DIGIT_EXPLICIT_CATEGORY");
    return true;
  }

  // B is the historical input prefix for canonical G. A maps to E.
  // Direct E/F/G aliases are also supported in Settings.
  if (prefix === "B" || prefix === "G") {
    for (const code of codes) acc.add("G", code, quantitySpec.first);
    rules.add(prefix === "B" ? "R_3DIGIT_PREFIX_B_TO_G" : "R_3DIGIT_CATEGORY_G");
    return true;
  }

  if (prefix === "F") {
    if (quantitySpec.type !== "SINGLE") {
      errors.push({ code: "UNSUPPORTED_EXPLICIT_CATEGORY_PAIR", detail: line });
      rules.add("R_3DIGIT_CATEGORY_F");
      return true;
    }
    for (const code of codes) acc.add("F", code, quantitySpec.first);
    rules.add("R_3DIGIT_CATEGORY_F");
    return true;
  }

  if (prefix === "E" && quantitySpec.type === "SINGLE") {
    for (const code of codes) acc.add("E", code, quantitySpec.first);
    rules.add("R_3DIGIT_CATEGORY_E");
    return true;
  }

  if (quantitySpec.type === "SINGLE") {
    for (const code of codes) acc.add("E", code, quantitySpec.first);
    rules.add(prefix === "A" ? "R_3DIGIT_PREFIX_A_TO_E" : "R_3DIGIT_DEFAULT_E");
    return true;
  }

  const q1 = quantitySpec.first;
  const q2 = quantitySpec.second;

  // Permutation syntax is only valid for ONE 3-digit code. A list such as
  // 920,202,707,101=500x500 is always an E/F quantity pair for every code.
  if (codes.length === 1 && !prefix && q2 <= 6) {
    const code = codes[0];
    const perms = uniquePermutations(code);
    if (perms.length !== q2) {
      errors.push({
        code: "PERMUTATION_COUNT_MISMATCH",
        detail: `${code} มี unique permutations ${perms.length} แบบ แต่ระบุ x${q2}`
      });
      rules.add("R_3DIGIT_PERMUTATION_VALIDATION");
      return true;
    }
    for (const p of perms) acc.add("E", p, q1);
    rules.add("R_3DIGIT_PERMUTATION");
    return true;
  }

  // No category or A/E input + quantity pair => E/F pair.
  for (const code of codes) {
    acc.add("E", code, q1);
    acc.add("F", code, q2);
  }
  rules.add(prefix === "A" || prefix === "E" ? "R_3DIGIT_A_EF_PAIR" : "R_3DIGIT_EF_PAIR");
  return true;
}


function stripExcludeDoublePhrase(text) {
  const raw = String(text || "");
  const pattern = /(?:\(\s*)?(ไม่เอาเบิ้ล|ไม่เบิ้ล)(?:\s*\))?/giu;
  const excludeDoubles = pattern.test(raw);
  pattern.lastIndex = 0;
  return {
    text: raw.replace(pattern, " ").replace(/\s+/g, " ").trim(),
    excludeDoubles,
  };
}

function matchLeadingAlias(text, cfg, target, { includeCanonical = true } = {}) {
  const raw = String(text || "").trim();
  const candidates = aliasesForTarget(cfg, target).slice();
  if (includeCanonical && !candidates.some((x) => normalizeLatin(x) === target)) {
    candidates.push(target);
  }
  candidates.sort((a, b) => b.length - a.length);

  for (const alias of candidates) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = raw.match(new RegExp(`^${escaped}(?=$|\\s|[-=0-9])`, "iu"));
    if (!match) continue;
    return { alias: match[0], remainder: raw.slice(match[0].length).trim() };
  }
  return null;
}

function isKnownGeneratorOrderLikeLine(text) {
  const raw = String(text || "").trim();

  // P2B safety only.
  //
  // Supported generator commands are parsed elsewhere. This helper
  // identifies a known generator that remains unconsumed so it cannot
  // silently become IGNORE.
  //
  // Production examples:
  //
  //   เพิ่มรูดเบิ้ล 1000 บล
  //   เพิ่ม รูดเบิ้ล 1000 บล
  //
  // "เพิ่ม" is treated only as a narrow leading operational prefix.
  // Do NOT remove it or infer the underlying generator semantics here.
  return /^(?:เพิ่ม\s*)?(?:รูดเบิ้ล|รูด|เบิ้ล)(?=\s|[-=0-9]|$)/u.test(
    raw
  );
}


function parseSweepTwoDigitLine(line, cfg, acc, rules) {
  const t = stripPoliteWords(normalizeLatin(line.trim()));
  const excluded = stripExcludeDoublePhrase(t);
  const clean = excluded.text;

  // Longest/specific generator first: "รูดเบิ้ล" must never be consumed as "รูด".
  const configuredDoubleLead =
    matchLeadingAlias(clean, cfg, "DOUBLE");

  const builtinDoubleMatch =
    clean.match(/^เบิ้ล(?=$|\s|[-=0-9])/u);

  const builtinDoubleLead =
    builtinDoubleMatch
      ? {
          alias: builtinDoubleMatch[0],
          remainder: clean
            .slice(builtinDoubleMatch[0].length)
            .trim(),
        }
      : null;

  const doubleLead =
    configuredDoubleLead ||
    builtinDoubleLead;
  if (doubleLead) {
    const m = doubleLead.remainder.match(/^[\s]*[-=]?[\s]*(\d+(?:\s*[xX*\/]\s*\d+)?)(?:\s+(.*))?$/u);
    if (!m) return false;
    const quantitySpec = parseQuantityExpression(m[1]);
    if (!quantitySpec) return false;
    let modifier = m[2] ? modifierFromExpression(m[2], cfg) : null;
    if (m[2] && !modifier) return false;
    if (!modifier || !(modifier.categories || []).length) {
      modifier = quantitySpec.type === "PAIR"
        ? mergeModifiers(modifier, { categories: ["A", "B"], reverse: false })
        : mergeModifiers(modifier, { categories: [cfg.defaultCategoryByCodeLength[2] || "A"], reverse: false });
    }
    const codes = Array.from({ length: 10 }, (_, i) => `${i}${i}`);
    emitTwoDigitGroup(acc, codes, quantitySpec, modifier, { excludeDoubles: excluded.excludeDoubles });
    rules.add("R_SWEEP_DOUBLE_SET");
    if (modifier.reverse) rules.add("R_REVERSE");
    if (excluded.excludeDoubles) rules.add("R_EXCLUDE_DOUBLE");
    return true;
  }

  const decadeLead = matchLeadingAlias(clean, cfg, "D");
  if (!decadeLead) return false;

  // Natural chat grammar: รูด 1-300 บล / รูด 0-500 บลก (ไม่เอาเบิ้ล)
  const m = decadeLead.remainder.match(/^([0-9])\s*[-=]\s*(\d+(?:\s*[xX*\/]\s*\d+)?)(?:\s+(.*))?$/u);
  if (!m) return false;
  const decadeDigit = m[1];
  const quantitySpec = parseQuantityExpression(m[2]);
  if (!quantitySpec) return false;
  let modifier = m[3] ? modifierFromExpression(m[3], cfg) : null;
  if (m[3] && !modifier) return false;
  if (!modifier || !(modifier.categories || []).length) {
    modifier = quantitySpec.type === "PAIR"
      ? mergeModifiers(modifier, { categories: ["A", "B"], reverse: false })
      : mergeModifiers(modifier, { categories: [cfg.defaultCategoryByCodeLength[2] || "A"], reverse: false });
  }

  const codes = Array.from({ length: 10 }, (_, i) => `${decadeDigit}${i}`);
  emitTwoDigitGroup(acc, codes, quantitySpec, modifier, { excludeDoubles: excluded.excludeDoubles });
  rules.add("R_SWEEP_DECADE_SET");
  if (modifier.reverse) rules.add("R_REVERSE");
  if (excluded.excludeDoubles) rules.add("R_EXCLUDE_DOUBLE");
  return true;
}

function parseSpecialTwoDigitLine(line, cfg, acc, rules, errors) {
  const t = stripPoliteWords(normalizeLatin(line.trim()));
  const eqIndex = t.indexOf("=");
  if (eqIndex < 0 || t.indexOf("=", eqIndex + 1) >= 0) return false;

  const left = t.slice(0, eqIndex).trim();
  const right = t.slice(eqIndex + 1).trim();
  const quantityMatch = right.match(/^(\d+(?:\s*[xX*\/]\s*\d+)?)(?:\s+(.*))?$/u);
  if (!quantityMatch) return false;
  const quantitySpec = parseQuantityExpression(quantityMatch[1]);
  if (!quantitySpec) return false;
  const rightModifier = quantityMatch[2] ? modifierFromExpression(quantityMatch[2], cfg) : null;
  if (quantityMatch[2] && !rightModifier) return false;

  // G is retained as the compact built-in double-number generator.
  // Custom aliases target DOUBLE so canonical G remains available for 3-digit category G.
  let doubleRemainder = null;
  const literalDouble = left.match(/^G(?:\s+(.*))?$/i);
  if (literalDouble) doubleRemainder = literalDouble[1] || "";
  if (doubleRemainder == null) {
    for (const alias of aliasesForTarget(cfg, "DOUBLE")) {
      if (normalizeLatin(alias) === "DOUBLE") continue;
      if (left === alias) { doubleRemainder = ""; break; }
      if (left.startsWith(`${alias} `)) { doubleRemainder = left.slice(alias.length).trim(); break; }
    }
  }

  if (doubleRemainder != null) {
    const leftModifier = doubleRemainder ? modifierFromExpression(doubleRemainder, cfg) : null;
    if (doubleRemainder && !leftModifier) return false;
    const mod = mergeModifiers(leftModifier, rightModifier);
    if (!(mod.categories || []).length) return false;
    const codes = Array.from({ length: 10 }, (_, i) => `${i}${i}`);
    emitTwoDigitGroup(acc, codes, quantitySpec, mod);
    rules.add("R_G_DOUBLE_SET");
    return true;
  }

  // D5 / custom-D-alias + 5 => decade set 50..59. Modifier may appear
  // before or after '=': D5 ABC=20 or D5=20 ABC.
  let decadeDigit = null;
  let decadeRemainder = "";
  let dm = left.match(/^D\s*([0-9])(?:\s+(.*))?$/i);
  if (dm) {
    decadeDigit = dm[1];
    decadeRemainder = dm[2] || "";
  } else {
    for (const alias of aliasesForTarget(cfg, "D")) {
      if (normalizeLatin(alias) === "D") continue;
      if (!left.startsWith(alias)) continue;
      const rest = left.slice(alias.length);
      const am = rest.match(/^\s*([0-9])(?:\s+(.*))?$/u);
      if (!am) continue;
      decadeDigit = am[1];
      decadeRemainder = am[2] || "";
      break;
    }
  }

  if (decadeDigit != null) {
    const leftModifier = decadeRemainder ? modifierFromExpression(decadeRemainder, cfg) : null;
    if (decadeRemainder && !leftModifier) return false;
    let mod = mergeModifiers(leftModifier, rightModifier);
    if (!(mod.categories || []).length) {
      mod = quantitySpec.type === "PAIR"
        ? mergeModifiers(mod, { categories: ["A", "B"], reverse: false })
        : mergeModifiers(mod, { categories: ["A"], reverse: false });
    }
    const codes = Array.from({ length: 10 }, (_, i) => `${decadeDigit}${i}`);
    emitTwoDigitGroup(acc, codes, quantitySpec, mod);
    rules.add("R_D_DECADE_SET");
    if (mod.reverse) rules.add("R_REVERSE");
    return true;
  }

  return false;
}

function parseTwoDigitSegment(segment, cfg, acc, rules, warnings, errors) {
  const lines = segment
    .split("\n")
    .map(x => stripPoliteWords(x.trim()))
    .filter(Boolean);

  let contextModifier = null;
  let pendingCodes = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const isLast = i === lines.length - 1;

    if (
      isMetadataLine(line) ||
      isSafeChatMetadataLine(line)
    ) continue;

    // Skip checksum line here; checksum handled at higher level.
    if (/^รวม\s+[A-Zก-๙]+\s+\d+$/iu.test(line)) continue;

    // --------------------------------------------------------
    // P2C boundary safety:
    //
    //   886
    //   887
    //   889
    //   -50*3ก
    //
    // The terminal counted-permutation quantity belongs to the
    // preceding 3-digit block. Until multiline 3ก semantics are
    // explicitly implemented, never allow "50" to leak into the
    // 2-digit pending-code state.
    //
    // This does NOT parse or emit the 3-digit order.
    // --------------------------------------------------------
    if (
      /^-\s*[\d,]+\s*[xX*×]\s*3ก$/u.test(line)
    ) {
      warnings.push({
        code: "UNRECOGNIZED_ORDER_LIKE_TEXT",
        detail: line,
      });

      pendingCodes = [];
      continue;
    }

    // --------------------------------------------------------
    // P1 boundary safety:
    //
    //   572-50*50
    //
    // is a recognizable but unsupported 3-digit dash assignment.
    // It must never leak the quantity tokens (50,50) into the
    // 2-digit pending-code state.
    //
    // A contextual production form may be normalized to '='
    // earlier by P1B. A remaining raw form stays Review-safe.
    // --------------------------------------------------------
    if (
      /^\d{3}\s*-\s*\d+\s*[xX*\/×]\s*\d+$/u.test(
        line
      )
    ) {
      warnings.push({
        code: "UNRECOGNIZED_ORDER_LIKE_TEXT",
        detail: line,
      });

      continue;
    }

    // Natural sweep shorthand and complete special expressions.
    if (parseSweepTwoDigitLine(line, cfg, acc, rules)) {
      pendingCodes = [];
      continue;
    }
    if (parseSpecialTwoDigitLine(line, cfg, acc, rules, errors)) {
      pendingCodes = [];
      continue;
    }

    // --------------------------------------------------------
    // Fail-closed generator safety.
    //
    // A known generator such as รูด/เบิ้ล that was not consumed
    // by parseSweepTwoDigitLine() or parseSpecialTwoDigitLine()
    // is still order-like. Do not let a partially recognizable
    // quantity make it silently disappear as IGNORE.
    //
    // Examples:
    //
    //   รูด 7 = 500 บ/ล
    //   รูด7=500 บ/ล
    //
    // Until that exact shorthand is explicitly supported,
    // keep it Review-safe rather than guessing semantics.
    // --------------------------------------------------------
    if (
      isKnownGeneratorOrderLikeLine(line)
    ) {
      warnings.push({
        code: "UNRECOGNIZED_ORDER_LIKE_TEXT",
        detail: line,
      });

      pendingCodes = [];
      continue;
    }

    // Combined 2-digit context: "บนล่าง" means both A and B.
    // Keep this exact/narrow so 3-digit contextual semantics are unchanged.
    if (/^บน\s*ล่าง$/u.test(line)) {
      contextModifier = { categories: ["A", "B"], reverse: false };
      rules.add("R_2DIGIT_CONTEXT_TOP_BOTTOM");
      continue;
    }

    // Contextual 2-digit header: บน/บ => A, ล่าง/ล => B.
    const exactDirection = contextualDirectionFromToken(line);
    if (exactDirection) {
      contextModifier = directionModifier(exactDirection);
      rules.add(`R_2DIGIT_CONTEXT_${exactDirection}`);
      continue;
    }

    // Exact category header.
    const exactMod = modifierFromToken(line, cfg);
    if (exactMod) {
      contextModifier = mergeModifiers(contextModifier, exactMod);
      rules.add("R_CATEGORY_HEADER");
      if (exactMod.reverse) rules.add("R_REVERSE");
      continue;
    }

    // A5 / B5 / บล 15 / บลก 15 after pending codes.
    //
    // Use the existing modifier parser instead of resolving only a single
    // category. This preserves composite semantics:
    //   บล  => A+B
    //   บลก => A+B+reverse
    //
    // Require at least one A/B destination so reverse-only or unrelated
    // aliases cannot accidentally close a pending 2-digit block.
    if (pendingCodes.length) {
      const aliasQty = line.match(/^([A-Za-z\u0E00-\u0E7F]+)\s*(\d+)$/u);

      if (aliasQty) {
        const aliasModifier =
          modifierFromToken(aliasQty[1], cfg);

        const hasTwoDigitDestination =
          (aliasModifier?.categories || []).some(
            (category) =>
              category === "A" ||
              category === "B"
          );

        if (
          aliasModifier &&
          hasTwoDigitDestination
        ) {
          emitTwoDigitGroup(
            acc,
            pendingCodes,
            {
              type: "SINGLE",
              first: Number(aliasQty[2]),
            },
            aliasModifier
          );

          pendingCodes = [];
          rules.add("R_ALIAS_QUANTITY");

          if (aliasModifier.reverse) {
            rules.add("R_REVERSE");
          }

          continue;
        }
      }
    }

    // Contextual slash pair: only final line after prior codes acts as A/B quantities.
    if (pendingCodes.length && isLast && /^\d+\s*\/\s*\d+$/.test(line)) {
      const q = parseQuantityExpression(line);
      emitTwoDigitGroup(
        acc,
        pendingCodes,
        q,
        contextModifier || { categories: ["A", "B"], reverse: false }
      );
      pendingCodes = [];
      rules.add("R_CONTEXTUAL_SLASH_QUANTITY");
      continue;
    }

    // Standalone quantity on final/next line after pending codes, e.g. "20".
    if (
      pendingCodes.length &&
      isLast &&
      /^\d+$/.test(line) &&
      !/^\d{2}$/.test(line)
    ) {
      const q = parseQuantityExpression(line);
      emitTwoDigitGroup(
        acc,
        pendingCodes,
        q,
        contextModifier || { categories: [cfg.defaultCategoryByCodeLength[2] || "A"], reverse: false }
      );
      pendingCodes = [];
      rules.add("R_STANDALONE_QUANTITY");
      continue;
    }

    // TOP/BOTTOM can be written before codes or after the quantity. They are
    // resolved only after this line is known to be in the 2-digit parser.
    const leadingDirection = stripLeadingContextualDirection(line);
    const trailingDirection = stripTrailingContextualDirection(leadingDirection.text);
    const contextual = mergeContextualDirections(leadingDirection.direction, trailingDirection.direction);
    if (contextual.conflict) {
      errors.push({ code: "CONTEXT_DIRECTION_CONFLICT", detail: line });
      continue;
    }
    const directionMod = directionModifier(contextual.direction);
    let directionalLine = trailingDirection.text;

    let inline = findInlineModifier(directionalLine, cfg);
    let localModifier = mergeModifiers(directionMod, inline ? inline.modifier : null);
    if (!(localModifier.categories || []).length && !localModifier.reverse) localModifier = null;
    let working = removeModifierToken(directionalLine, inline);
    if (contextual.direction) rules.add(`R_2DIGIT_CONTEXT_${contextual.direction}`);

    // Compact 2-digit A/B pair:
    //
    // 77*20*20 => A77=20, B77=20
    //
    // Keep this exact to TWO leading digits so this rule cannot consume
    // 3-digit permutation-like forms such as 249*5*5.
    const compactStarPair = working.match(
      /^(\d{2})\s*\*\s*(\d+)\s*\*\s*(\d+)$/u
    );

    if (compactStarPair) {
      const inherited = localModifier || contextModifier;

      const modifier =
        inherited ||
        { categories: ["A", "B"], reverse: false };

      emitTwoDigitGroup(
        acc,
        [compactStarPair[1]],
        {
          type: "PAIR",
          first: Number(compactStarPair[2]),
          second: Number(compactStarPair[3]),
          delimiter: "*",
        },
        modifier
      );

      rules.add("R_COMPACT_STAR_QUANTITY_PAIR");

      if (modifier.reverse) {
        rules.add("R_REVERSE");
      }

      continue;
    }

    // Real-chat colon shorthand:
    // 10\n01\n33:200:200 => A/B 10,01,33 = 200/200
    // บน\n06:200        => A06 = 200
    // ล่าง\n60:200      => B60 = 200
    const colonPair = working.match(/^(\d{2})\s*:\s*(\d+)\s*[:;/]\s*(\d+)$/u);
    if (colonPair) {
      pendingCodes.push(colonPair[1]);
      const inherited = localModifier || contextModifier;
      emitTwoDigitGroup(
        acc,
        pendingCodes,
        {
          type: "PAIR",
          first: Number(colonPair[2]),
          second: Number(colonPair[3]),
          delimiter: working.includes(";") ? ";" : working.includes("/") ? "/" : ":"
        },
        {
          categories: ["A", "B"],
          reverse: Boolean(inherited?.reverse)
        }
      );
      pendingCodes = [];
      rules.add("R_COLON_QUANTITY_PAIR");
      if (inherited?.reverse) rules.add("R_REVERSE");
      continue;
    }

    const colonSingle = working.match(/^(\d{2})\s*:\s*(\d+)$/u);
    if (colonSingle) {
      pendingCodes.push(colonSingle[1]);
      const modifier =
        localModifier ||
        contextModifier ||
        { categories: [cfg.defaultCategoryByCodeLength[2] || "A"], reverse: false };

      emitTwoDigitGroup(
        acc,
        pendingCodes,
        {
          type: "SINGLE",
          first: Number(colonSingle[2]),
          second: null,
          delimiter: ":"
        },
        modifier
      );
      pendingCodes = [];
      rules.add("R_COLON_SINGLE_QUANTITY");
      if (modifier.reverse) rules.add("R_REVERSE");
      continue;
    }

    // Handle attached A01/B01.
    if (inline && inline.attached) {
      // removeModifierToken already removes the leading letter
    }

    let quantitySpec = null;
    let codePart = working;

    if (working.includes("=")) {
      const idx = working.indexOf("=");
      codePart = working.slice(0, idx).trim();
      const right = working.slice(idx + 1).trim();

      // Keep only leading quantity expression from RHS; modifier may have been removed already.
      const qm = right.match(
        /^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\s*[xX*\/]\s*(?:\d{1,3}(?:,\d{3})+|\d+))?)/
      );
      if (qm) quantitySpec = parseQuantityExpression(qm[1]);
    } else {
      // Inline pair at end: "01-05 AB 20x20" / "... 5*5"
      let qm = working.match(
        /(?:^|\s)((?:\d{1,3}(?:,\d{3})+|\d+)\s*[xX*]\s*(?:\d{1,3}(?:,\d{3})+|\d+))\s*$/
      );
      if (qm) {
        quantitySpec = parseQuantityExpression(qm[1]);
        codePart = working.slice(0, qm.index).trim();
      } else if (localModifier) {
        // Fast chat form with an explicit modifier followed by one quantity:
        // 39/36//94/64/34 บลก 10
        // 96 บลก 20
        qm = working.match(/(?:^|\s)(\d+)\s*$/);
        if (qm) {
          const candidateCodePart = working.slice(0, qm.index).trim();
          if (extractTwoDigitCodes(candidateCodePart).length) {
            quantitySpec = parseQuantityExpression(qm[1]);
            codePart = candidateCodePart;
          }
        }
      }
    }

    const codes = extractTwoDigitCodes(codePart);
    if (codes.length) pendingCodes.push(...codes);

    if (quantitySpec && pendingCodes.length) {
      let modifier = localModifier || contextModifier;

      // Pair with no explicit category means A/B.
      if (!modifier && quantitySpec.type === "PAIR") {
        modifier = { categories: ["A", "B"], reverse: false };
      }
      if (!modifier) {
        modifier = { categories: [cfg.defaultCategoryByCodeLength[2] || "A"], reverse: false };
      }

      emitTwoDigitGroup(acc, pendingCodes, quantitySpec, modifier);
      pendingCodes = [];
      rules.add(quantitySpec.type === "PAIR" ? "R_2DIGIT_QUANTITY_PAIR" : "R_2DIGIT_SINGLE_QUANTITY");

      if (modifier.reverse) rules.add("R_REVERSE");
      continue;
    }

    // A modifier appearing without a completed quantity becomes the current context.
    if (localModifier) {
      contextModifier = mergeModifiers(contextModifier, localModifier);
      if (localModifier.reverse) rules.add("R_REVERSE");
    }

    // If a line contains no recognizable order structure, keep it as warning only
    // when it looks order-like; ordinary Thai chat is ignored.
    if (!codes.length && !quantitySpec && !localModifier) {
      if (/[0-9=/*:]/.test(line)) {
        warnings.push({ code: "UNRECOGNIZED_ORDER_LIKE_TEXT", detail: line });
      }
    }
  }

  if (pendingCodes.length) {
    errors.push({
      code: "PENDING_CODES_WITHOUT_QUANTITY",
      detail: pendingCodes.join(",")
    });
  }
}

function isNonOrderSummaryLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;

  // Allow only decorative symbols/emoji before a known summary phrase.
  // The original text is preserved for all other parser semantics.
  const summaryText = text
    .replace(/^[^\p{L}\p{M}\d=]+/u, "")
    .trimStart();

  // Clearly aggregate/reporting text sent back into the LINE group.
  // This must be narrow: never ignore merely because a line contains "รวม".
  if (
    /^รวม\s+[23]\s*ตัว(?:ตรง|โต๊ด|บน|ล่าง)(?:\s+[\d,]+(?:\.\d+)?)?$/iu.test(summaryText)
  ) {
    return true;
  }

  if (
    /^(?:ยอด|รวม)\s*[\d,]+(?:\.\d+)?(?:\s*(?:฿|บาท|\.-))?(?:\s+.*)?$/iu.test(summaryText)
  ) {
    return true;
  }

  return /^(?:สรุป(?:ยอด)?|ยอดรวม|รวมยอด|ยอดวันนี้|ยอดปัจจุบัน|รวมตรง|รวมวิ่ง|รวมทั้งหมด)(?:\s|[:|]|$)/iu.test(summaryText);
}


function isA5TwoDigitCodeListLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;

  const parts = raw
    .split(/[\s,/:.]+/u)
    .filter(Boolean);

  if (
    !parts.length ||
    parts.some((part) => !/^\d{2}$/.test(part))
  ) {
    return null;
  }

  const residue = raw
    .replace(/\d{2}/g, "")
    .replace(/[\s,/:.]/g, "");

  return residue ? null : parts;
}

function isA5ThreeDigitCodeListLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;

  const parts = raw
    .split(/[\s,/:.]+/u)
    .filter(Boolean);

  if (
    !parts.length ||
    parts.some((part) => !/^\d{3}$/.test(part))
  ) {
    return null;
  }

  const residue = raw
    .replace(/\d{3}/g, "")
    .replace(/[\s,/:.]/g, "");

  return residue ? null : parts;
}

function isThaiTextualDateMetadataLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return false;

  // Examples:
  //   28 สค. 69
  //   28 ส.ค. 69
  //
  // Keep this narrow:
  // - valid day
  // - explicit Thai month abbreviation
  // - 2-digit year >= 20 or 4-digit year
  const month =
    "(?:ม\\.?\\s*ค\\.?|ก\\.?\\s*พ\\.?|มี\\.?\\s*ค\\.?|เม\\.?\\s*ย\\.?|พ\\.?\\s*ค\\.?|มิ\\.?\\s*ย\\.?|ก\\.?\\s*ค\\.?|ส\\.?\\s*ค\\.?|ก\\.?\\s*ย\\.?|ต\\.?\\s*ค\\.?|พ\\.?\\s*ย\\.?|ธ\\.?\\s*ค\\.?)";

  return new RegExp(
    `^(?:0?[1-9]|[12]\\d|3[01])\\s+${month}\\s+(?:[2-9]\\d|\\d{4})$`,
    "iu",
  ).test(raw);
}

function normalizeTrailingNaturalMetadataAfterCompletedBlg(text) {
  const lines = String(text || "").split("\n");

  return lines
    .map((raw) => {
      const line = String(raw || "").trim();

      if (!line) return raw;

      // P2A-01
      //
      //   19 75 56 -300 บลก ลาวค่ะ
      //
      // becomes:
      //
      //   19 75 56 -300 บลก
      //
      // This runs before the review normalizers so they cannot
      // reinterpret the completed order before the natural suffix
      // has been removed.
      //
      // Safety:
      // - at least two explicit 2-digit codes
      // - explicit dash quantity
      // - explicit บลก
      // - suffix must not contain any numeric/operator/order signal
      const match = line.match(
        /^((?:\d{2}\s+){1,}\d{2})\s*-\s*([\d,]+)\s+(บลก)\s+(.+)$/u
      );

      if (!match) return raw;

      const suffix = String(match[4] || "").trim();

      if (!suffix) return raw;

      const suffixHasOrderSignal =
        /[0-9=/*:xX×]/u.test(suffix) ||
        /(?:บน|ล่าง|บลก|บล|โต๊ด|โต้ด|รูด|เบิ้ล|ตรง|ตัวละ|3ก)/u.test(
          suffix
        );

      if (suffixHasOrderSignal) {
        return raw;
      }

      return `${match[1]}-${match[2]} ${match[3]}`;
    })
    .join("\n");
}


function normalizeReviewA5Grammar(text) {
  const lines = String(text || "").split("\n");
  const out = [];

  const nextNonBlankIndex = (start) => {
    let i = start;

    while (
      i < lines.length &&
      !String(lines[i] || "").trim()
    ) {
      i++;
    }

    return i;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] || "");
    const line = raw.trim();

    if (!line) {
      out.push("");
      continue;
    }

    // --------------------------------------------------------
    // A5-07
    // Thai textual date metadata.
    //
    // 28 สค. 69
    // --------------------------------------------------------
    if (isThaiTextualDateMetadataLine(line)) {
      continue;
    }


    // --------------------------------------------------------
    // A5-03
    //
    // 753 539 397 975-50*50
    //
    // At least TWO 3-digit codes are required.
    // This deliberately excludes:
    //
    // 593-50*50
    // --------------------------------------------------------
    const multiThreeDigitDashPair = line.match(
      /^((?:\d{3}\s+)+\d{3})\s*-\s*(\d+\s*[xX*\/]\s*\d+)(?:\s+(.+))?$/u
    );

    if (multiThreeDigitDashPair) {
      const codes =
        multiThreeDigitDashPair[1]
          .trim()
          .split(/\s+/);

      if (codes.length >= 2) {
        const suffix = String(
          multiThreeDigitDashPair[3] || ""
        ).trim();

        out.push(
          `${codes.join(" ")}=${multiThreeDigitDashPair[2]}${suffix ? ` ${suffix}` : ""}`
        );

        continue;
      }
    }


    // --------------------------------------------------------
    // A5-01 / A5-02
    //
    // 247
    // 471
    // 712
    // 124
    // -50*50 บน
    //
    // Require at least TWO accumulated 3-digit codes.
    // --------------------------------------------------------
    const firstThreeCodes =
      isA5ThreeDigitCodeListLine(line);

    if (firstThreeCodes) {
      const codes = [...firstThreeCodes];
      let j = i + 1;

      while (j < lines.length) {
        const candidate =
          String(lines[j] || "").trim();

        if (!candidate) {
          j++;
          continue;
        }

        const moreCodes =
          isA5ThreeDigitCodeListLine(candidate);

        if (!moreCodes) break;

        codes.push(...moreCodes);
        j++;
      }

      const quantityIndex =
        nextNonBlankIndex(j);

      if (
        codes.length >= 2 &&
        quantityIndex < lines.length
      ) {
        const quantityLine =
          String(lines[quantityIndex] || "").trim();

        const trailingPair = quantityLine.match(
          /^-\s*(\d+\s*[xX*\/]\s*\d+)(?:\s+(.+))?$/u
        );

        if (trailingPair) {
          const suffix =
            String(trailingPair[2] || "").trim();

          out.push(
            `${codes.join(" ")}=${trailingPair[1]}${suffix ? ` ${suffix}` : ""}`
          );

          i = quantityIndex;
          continue;
        }
      }
    }


    // --------------------------------------------------------
    // P1B: contextual single 3-digit dash pair before a confirmed
    // production P1A 2-digit block.
    //
    //   572-50*50
    //
    //   57
    //   52
    //   72-50 บลก
    //
    // becomes internally:
    //
    //   572=50*50
    //
    // followed by the unchanged P1A block.
    //
    // Safety:
    // - the 3-digit dash line alone remains unsupported
    // - require at least TWO following pure 2-digit codes
    // - require a terminal NN-qty with explicit supported modifier
    // --------------------------------------------------------
    const contextualThreeDigitDashPair =
      line.match(
        /^(\d{3})\s*-\s*(\d+\s*[xX*\/×]\s*\d+)$/u
      );

    if (contextualThreeDigitDashPair) {
      const followingCodes = [];

      let j =
        nextNonBlankIndex(i + 1);

      while (j < lines.length) {
        const candidate =
          String(lines[j] || "").trim();

        const codeList =
          isA5TwoDigitCodeListLine(candidate);

        if (!codeList) break;

        followingCodes.push(...codeList);

        j =
          nextNonBlankIndex(j + 1);
      }

      if (
        followingCodes.length >= 2
        && j < lines.length
      ) {
        const terminal =
          String(lines[j] || "").trim();

        const terminalAssignment =
          terminal.match(
            /^(\d{2})\s*-\s*(\d+)\s+(บลก|บล|ล-บ|บ-ล|บน-ล่าง|ล่าง-บน|บนล่าง)$/u
          );

        if (terminalAssignment) {
          out.push(
            `${contextualThreeDigitDashPair[1]}=${contextualThreeDigitDashPair[2]}`
          );

          continue;
        }
      }
    }


    // --------------------------------------------------------
    // P1A: production multiline 2-digit block with terminal
    // single quantity + explicit modifier.
    //
    //   64
    //   63
    //   61
    //   71-25 บลก
    //
    // becomes:
    //
    //   64 63 61 71=25 บลก
    //
    // Keep this deliberately contextual:
    // - require at least TWO preceding pure 2-digit codes
    // - require an explicit supported modifier on the terminal line
    // - do not generalize a standalone "71-25 บลก"
    // --------------------------------------------------------
    const firstProductionTwoDigitCodes =
      isA5TwoDigitCodeListLine(line);

    if (firstProductionTwoDigitCodes) {
      const codes = [
        ...firstProductionTwoDigitCodes,
      ];

      let j = i + 1;

      while (j < lines.length) {
        const candidate =
          String(lines[j] || "").trim();

        if (!candidate) {
          j++;
          continue;
        }

        const moreCodes =
          isA5TwoDigitCodeListLine(candidate);

        if (!moreCodes) break;

        codes.push(...moreCodes);
        j++;
      }

      const terminalIndex =
        nextNonBlankIndex(j);

      if (
        codes.length >= 2
        && terminalIndex < lines.length
      ) {
        const terminal =
          String(
            lines[terminalIndex] || ""
          ).trim();

        const terminalAssignment =
          terminal.match(
            /^(\d{2})\s*-\s*(\d+)\s+(บลก|บล|ล-บ|บ-ล|บน-ล่าง|ล่าง-บน|บนล่าง)$/u
          );

        if (terminalAssignment) {
          out.push(
            `${codes.concat(
              terminalAssignment[1]
            ).join(" ")}=${terminalAssignment[2]} ${terminalAssignment[3]}`
          );

          i = terminalIndex;
          continue;
        }
      }
    }


    // --------------------------------------------------------
    // A5-04 / A5-05
    //
    // บลก 1500*1500
    // 53 37 96 45 48
    //
    // or:
    //
    // 2000*2000
    // 06
    // 60
    // ...
    // --------------------------------------------------------
    const modifierHeader = line.match(
      /^(บลก|บล|ล-บ|บ-ล|บน-ล่าง|ล่าง-บน|บนล่าง)\s+(\d+\s*[xX*\/]\s*\d+)$/u
    );

    const plainPairHeader = line.match(
      /^(\d+\s*[xX*\/]\s*\d+)$/u
    );

    if (modifierHeader || plainPairHeader) {
      const modifier =
        modifierHeader
          ? modifierHeader[1]
          : null;

      const quantity =
        modifierHeader
          ? modifierHeader[2]
          : plainPairHeader[1];

      const codes = [];

      let j =
        nextNonBlankIndex(i + 1);

      while (j < lines.length) {
        const candidate =
          String(lines[j] || "").trim();

        if (!candidate) {
          j++;
          continue;
        }

        const codeList =
          isA5TwoDigitCodeListLine(candidate);

        if (!codeList) break;

        codes.push(...codeList);
        j++;
      }

      if (codes.length) {
        if (modifier) {
          out.push(modifier);
        }

        out.push(
          `${codes.join(" ")}=${quantity}`
        );

        i = j - 1;
        continue;
      }
    }


    // --------------------------------------------------------
    // A5-06
    //
    // 78-500*500
    // 87-500*500
    // 12-500*500
    // 21-500*500
    // บนล่าง
    //
    // Require a trailing exact บนล่าง context.
    // Do not generalize arbitrary dash assignment.
    // --------------------------------------------------------
    const firstTwoDigitDashPair = line.match(
      /^(\d{2})\s*-\s*(\d+\s*[xX*\/×]\s*\d+)$/u
    );

    if (firstTwoDigitDashPair) {
      const assignments = [
        {
          code: firstTwoDigitDashPair[1],
          quantity: firstTwoDigitDashPair[2],
        },
      ];

      let j = i + 1;

      while (j < lines.length) {
        const candidate =
          String(lines[j] || "").trim();

        if (!candidate) {
          j++;
          continue;
        }

        const assignment = candidate.match(
          /^(\d{2})\s*-\s*(\d+\s*[xX*\/×]\s*\d+)$/u
        );

        if (!assignment) break;

        assignments.push({
          code: assignment[1],
          quantity: assignment[2],
        });

        j++;
      }

      const directionIndex =
        nextNonBlankIndex(j);

      if (
        directionIndex < lines.length &&
        /^บน\s*ล่าง$/u.test(
          String(lines[directionIndex] || "").trim()
        )
      ) {
        out.push("บนล่าง");

        for (const assignment of assignments) {
          out.push(
            `${assignment.code}=${assignment.quantity}`
          );
        }

        i = directionIndex;
        continue;
      }
    }



    // Phase 2A1: standalone 2-digit dash quantity pair.
    //
    //   17-500*500 => 17=500*500
    //   96-25×25  => 96=25*25
    //
    // firstTwoDigitDashPair is deliberately limited to exactly
    // two code digits plus an explicit PAIR quantity. Therefore
    // this cannot consume:
    //
    //   77-50
    //   71-25 บลก
    //   68-86-100
    //   593-50*50
    //
    // A5-06 above still takes precedence when a trailing
    // explicit บนล่าง block is present.
    if (firstTwoDigitDashPair) {
      const canonicalQuantity =
        firstTwoDigitDashPair[2]
          .replace(/[xX×]/gu, "*");

      out.push(
        `${firstTwoDigitDashPair[1]}=${canonicalQuantity}`
      );

      continue;
    }

    out.push(raw);
  }

  return out.join("\n");
}

// Return true only when THIS text fragment itself has a recognizable
// order skeleton. Do not infer order-likeness from unrelated lines in
// the same chat message.
//
// This intentionally answers:
//
//   "Does this line look structurally like an order?"
//
// rather than:
//
//   "Does this line contain a digit?"
//
// Therefore:
//
//   ลาวยึด4        => false
//   สมชาย99        => false
//   4=20           => true
//   01=20          => true
//   123=20         => true
//   593-50*50      => true
//   522=20*20*20   => true
function isOrderSkeletonLikeText(text) {
  const raw = String(text || "").trim();

  if (!raw) return false;

  // Explicit code assignment.
  //
  // Recognize both:
  //
  //   01=20
  //   123=20*30
  //
  // and malformed assignments whose LEFT side is unmistakably an
  // order-code expression:
  //
  //   999=abc
  //   397 349=foo
  //
  // The latter must go to Review rather than silently disappear.
  //
  // This stays line-local, so unrelated text such as:
  //
  //   ลาวยึด4
  //
  // is still harmless.
  if (
    /^\d{1,3}(?:[\s,./:\-]+\d{1,3})*\s*=\s*\S.*$/u.test(
      raw
    )
  ) {
    return true;
  }

  // Unsupported but clearly order-like 3-digit dash pair.
  if (
    /^\d{3}\s*-\s*\d+\s*[xX*\/]\s*\d+$/u.test(raw)
  ) {
    return true;
  }

  // Natural 3-digit order forms:
  //
  //   123 20 โต๊ด
  //   123 โต๊ด 20
  if (
    /^\d{3}(?:[\s,./:]+\d{3})*\s+\d+\s+\S+/u.test(raw) ||
    /^\d{3}(?:[\s,./:]+\d{3})*\s+\S+\s+\d+\s*$/u.test(raw)
  ) {
    return true;
  }

  // Explicit 1-digit category/operator grammar.
  if (
    /^(?:[HL]|วิ่งบน|วิ่งล่าง|วิ่ง\s*[บล])\s*\d(?:[\s,./:]+\d)*\s*=\s*\d+/iu.test(
      raw
    )
  ) {
    return true;
  }

  // Unsupported multiline counted-permutation terminal.
  //
  // Do not assign semantics here. This exists only so a boundary
  // warning such as "-50*3ก" remains Review-safe.
  if (
    /^-\s*[\d,]+\s*[xX*×]\s*3ก$/u.test(raw)
  ) {
    return true;
  }

  // Known order generators. Malformed variants must not disappear.
  if (
    isKnownGeneratorOrderLikeLine(raw)
  ) {
    return true;
  }

  return false;
}


// Detect a multi-line 3-digit order block whose business semantics are
// not yet implemented.
//
// Examples:
//
//   487
//   233
//   ตัวละ5*5
//
//   940
//   694
//   5*5
//
//   000-111-222-333-444-555-666-777-888-999
//   =20 ตรง
//
// These are strong order structures. They must remain Review-safe
// rather than silently becoming IGNORE.
//
// This helper does NOT parse or emit items.
function hasUnsupportedThreeDigitBlockSkeleton(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  if (lines.length < 2) return false;

  function threeDigitCodeFragment(line) {
    const raw = String(line || "").trim();

    if (
      !/^\d{3}(?:[\s,./:\-]+\d{3})*$/u.test(raw)
    ) {
      return 0;
    }

    const codes =
      raw.match(/\d{3}/g) || [];

    return codes.length;
  }

  function quantityFragment(line) {
    const raw = String(line || "").trim();

    return (
      /^(?:ตัวละ\s*)?\d+\s*[xX*\/]\s*\d+(?:\s+\S+)?$/u.test(
        raw
      ) ||
      /^=\s*\d+(?:\s*[xX*\/]\s*\d+)*(?:\s+\S+)?$/u.test(
        raw
      )
    );
  }

  let accumulatedCodes = 0;

  for (let i = 0; i < lines.length; i++) {
    const count =
      threeDigitCodeFragment(lines[i]);

    if (count > 0) {
      accumulatedCodes += count;
      continue;
    }

    if (
      accumulatedCodes >= 2 &&
      quantityFragment(lines[i])
    ) {
      return true;
    }

    // Once unrelated natural text interrupts the candidate block,
    // restart. This keeps the detector narrow.
    accumulatedCodes = 0;
  }

  return false;
}


function findAmbiguousSameLineOrderSyntax(text) {
  const lines = String(text || "").split("\n");

  for (const raw of lines) {
    const line = String(raw || "").trim();

    if (!line) continue;

    // Safety guard:
    //
    //   19 75 56 -300 บลก 01=20
    //
    // contains two independently order-like expressions on one line.
    // Existing parser precedence can incorrectly apply the later
    // quantity to the earlier codes. Never classify this as PARSED.
    //
    // Keep deliberately narrow to the confirmed production family.
    const match = line.match(
      /^(?:\d{2}\s+){1,}\d{2}\s*-\s*[\d,]+\s+บลก\s+(.+)$/u
    );

    if (
      match &&
      /\d{1,3}\s*=\s*[\d,]+(?:\s*[xX*×/]\s*[\d,]+)?/u.test(
        String(match[1] || "")
      )
    ) {
      return line;
    }
  }

  return null;
}


function parseOrder(inputText, config = {}) {
  const cfg = mergeConfig(config);
  const normalized = normalizeText(inputText);
  const parserText = normalizeThreeDigitVocabularyHeaders(
    normalizeReviewA5Grammar(
      normalizeCollectiveReviewGrammar(
        normalizeSafeReviewGrammar(
          normalizeMixedWidthInlineAssignments(
            normalizeTrailingNaturalMetadataAfterCompletedBlg(
              normalizeContextualShortDateMetadata(
                normalized
              )
            )
          )
        )
      )
    )
  );
  const acc = makeAccumulator();
  const rules = new Set();
  const warnings = [];
  const errors = [];
  const checksums = [];

  const ambiguousSameLineOrder =
    findAmbiguousSameLineOrderSyntax(normalized);

  if (ambiguousSameLineOrder) {
    errors.push({
      code: "AMBIGUOUS_SAME_LINE_ORDER_SYNTAX",
      detail: ambiguousSameLineOrder
    });
  }

  if (!normalized) {
    return {
      status: "IGNORE",
      items: [],
      warnings: [],
      errors: [],
      checksums: [],
      parser_version: PARSER_VERSION,
      rule_ids: [],
      normalized_text: ""
    };
  }

  // Slash surrounded by spaces = order-group separator.
  const segments = parserText.split(/\s+\/\s+/);

  for (const segmentRaw of segments) {
    const segment = segmentRaw.trim();
    if (!segment) continue;

    const rawLines = segment.split("\n");

    // A slash pair such as 500/500 is normally a valid 3-digit code list.
    // But immediately after a pure 2-digit code list it is an A/B quantity pair:
    // 07/70
    // 500/500
    const preserveTwoDigitSlashPair = rawLines.some((rawLine, index) => {
      if (index < 1) return false;

      const current = stripPoliteWords(String(rawLine || "").trim());
      if (!/^\d+\s*\/\s*\d+$/.test(current)) return false;

      const previous = stripPoliteWords(String(rawLines[index - 1] || "").trim());
      return Boolean(splitTwoDigitCodeList(previous));
    });

    const lines = preserveTwoDigitSlashPair
      ? rawLines
      : coalesceThreeDigitLines(rawLines);

    const remaining = [];
    let threeDigitConsumed = false;

    for (const rawLine of lines) {
      const line = stripPoliteWords(rawLine.trim());
      if (!line) continue;

      const checksum = normalizeLatin(line).match(/^รวม\s+([EFG])\s+(\d+)$/i);
      if (checksum) {
        checksums.push({
          category: checksum[1].toUpperCase(),
          expected: Number(checksum[2])
        });
        rules.add("R_CHECKSUM");
        continue;
      }

      if (
      isMetadataLine(line) ||
      isSafeChatMetadataLine(line)
    ) continue;
      if (isNonOrderSummaryLine(line)) continue;

      if (parseOneDigitLine(line, cfg, acc, rules)) {
        continue;
      }
      if (parseThreeDigitLine(line, cfg, acc, rules, errors)) {
        threeDigitConsumed = true;
      } else {
        remaining.push(line);
      }
    }

    if (remaining.length) {
      parseTwoDigitSegment(remaining.join("\n"), cfg, acc, rules, warnings, errors);
    }
  }

  const items = acc.values();

  // ----------------------------------------------------------
  // Vocabulary architecture safety
  // ----------------------------------------------------------
  //
  // A bare 1-digit assignment has a recognizable order skeleton,
  // but without วิ่งบน/วิ่งล่าง (or H/L) the destination cannot
  // be determined safely.
  //
  //   4=20
  //
  // Do not guess H or L and do not silently IGNORE it.
  const normalizedLines =
    normalized
      .split("\n")
      .map((line) => String(line || "").trim())
      .filter(Boolean);

  for (const line of normalizedLines) {
    if (
      /^\d(?:[\s,./:]+\d)*\s*=\s*\d+(?:\s*[xX*\/]\s*\d+)?$/u.test(
        line
      )
    ) {
      errors.push({
        code: "ONE_DIGIT_DIRECTION_REQUIRED",
        detail: line,
      });

      rules.add("R_1DIGIT_DIRECTION_REQUIRED");
    }
  }

  // A 3-digit '*' quantity chain is unmistakably order-like but is
  // intentionally not assigned semantics here.
  //
  // Existing x/x/x repeated-permutation grammar remains untouched.
  //
  //   522=20*20*20
  //
  // must therefore go to Review instead of disappearing as IGNORE.
  for (const line of normalizedLines) {
    if (
      /^\d{3}(?:[\s,/:.]+\d{3})*\s*=\s*\d+(?:\s*\*\s*\d+){2,}$/u.test(
        line
      )
    ) {
      errors.push({
        code: "UNSUPPORTED_QUANTITY_EXPRESSION",
        detail: line,
      });

      rules.add("R_ORDER_SKELETON_UNSUPPORTED_QUANTITY");
    }
  }

  for (const check of checksums) {
    const actual = items
      .filter(x => x.category === check.category)
      .reduce((sum, x) => sum + x.quantity, 0);
    check.actual = actual;
    check.ok = actual === check.expected;
    if (!check.ok) {
      errors.push({
        code: "CHECKSUM_MISMATCH",
        detail: `${check.category}: expected ${check.expected}, actual ${actual}`
      });
    }
  }

  // Never silently discard text that itself has an order skeleton.
  //
  // IMPORTANT:
  // Evaluate each warning DETAIL locally. A valid order elsewhere in
  // the same chat message must not turn unrelated text into an error.
  //
  // Before:
  //
  //   ลาวยึด4
  //   01=20
  //
  // "01=20" made the whole message stronglyOrderLike and promoted
  // "ลาวยึด4" to an error.
  //
  // Now only warning lines whose own structure is order-like are
  // eligible for Review/Partial promotion.
  const orderLikeWarningDetails =
    warnings
      .filter(
        (warning) =>
          warning.code === "UNRECOGNIZED_ORDER_LIKE_TEXT"
      )
      .map((warning) =>
        String(warning.detail || "").trim()
      )
      .filter(Boolean)
      .filter(isOrderSkeletonLikeText);

  // Remove false order-like warnings from ordinary text/name lines.
  // Other warning types are preserved unchanged.
  const effectiveWarnings =
    warnings.filter((warning) => {
      if (
        warning.code !== "UNRECOGNIZED_ORDER_LIKE_TEXT"
      ) {
        return true;
      }

      return isOrderSkeletonLikeText(
        warning.detail
      );
    });

  // Keep the dedicated historical protection for a single unsupported
  // 3-digit dash pair.
  const hasUnsupportedThreeDigitDashPairWarning =
    orderLikeWarningDetails.some((detail) =>
      /^\d{3}\s*-\s*\d+\s*[xX*\/×]\s*\d+$/u.test(
        detail
      )
    );

  // Some unsupported order structures only become identifiable when
  // several lines are considered together. Require an existing raw
  // order-like warning so a fully parsed legitimate block is never
  // downgraded merely because its source text resembles this shape.
  const hasRawOrderLikeWarning =
    warnings.some(
      (warning) =>
        warning.code ===
        "UNRECOGNIZED_ORDER_LIKE_TEXT"
    );

  const hasUnsupportedThreeDigitBlock =
    hasRawOrderLikeWarning &&
    hasUnsupportedThreeDigitBlockSkeleton(
      normalized
    );

  // Explicit known order command whose grammar is not yet supported.
  //
  // Only promote an actual unconsumed warning. A supported sweep such as
  // "รูด6=300*300" has already been consumed by parseSweepTwoDigitLine()
  // and must not be downgraded merely because its source contains "รูด...=".
  const explicitUnsupportedOrderLike =
    orderLikeWarningDetails.some((detail) =>
      /^รูด(?=\s|[-=0-9]|$)/u.test(detail)
    );

  if (
    explicitUnsupportedOrderLike ||
    hasUnsupportedThreeDigitDashPairWarning ||
    hasUnsupportedThreeDigitBlock ||
    orderLikeWarningDetails.length > 0
  ) {
    errors.push({
      code: "UNRECOGNIZED_ORDER_SYNTAX",
      detail:
        orderLikeWarningDetails.length
          ? orderLikeWarningDetails.join(" | ")
          : normalized,
    });
  }

  let status = "PARSED";
  if (!items.length && !errors.length) status = "IGNORE";
  else if (errors.length && items.length) status = "PARTIAL";
  else if (errors.length) status = "REVIEW";

  // Hard validation errors should force REVIEW even if some tentative items were produced.
  if (errors.some(e =>
    ["PERMUTATION_COUNT_MISMATCH", "CHECKSUM_MISMATCH", "PENDING_CODES_WITHOUT_QUANTITY"].includes(e.code)
  )) {
    status = items.length ? "PARTIAL" : "REVIEW";
  }

  return {
    status,
    items,
    warnings: effectiveWarnings,
    errors,
    checksums,
    parser_version: PARSER_VERSION,
    rule_ids: [...rules].sort(),
    normalized_text: normalized
  };
}

export { parseOrder, normalizeText, uniquePermutations, reverseCode, PARSER_VERSION };
