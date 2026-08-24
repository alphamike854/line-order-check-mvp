"use strict";

/**
 * LINE Order Parser v1.0.0
 * Pure JavaScript, no external dependencies.
 *
 * Design goals:
 * - deterministic parser: same input + config => same output
 * - independent from Google Sheets / Make / database
 * - configurable category aliases
 * - REVIEW instead of guessing when grammar is ambiguous
 */

const PARSER_VERSION = "1.0.0";

const DEFAULT_CONFIG = {
  aliases: {
    "A": "A",
    "B": "B",
    "E": "E",
    "F": "F",
    "G": "G",
    "น": "A"
  },
  defaultCategoryByCodeLength: {
    2: "A",
    3: "E"
  }
};

function mergeConfig(config = {}) {
  return {
    aliases: { ...DEFAULT_CONFIG.aliases, ...(config.aliases || {}) },
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

function emitTwoDigitGroup(acc, codes, quantitySpec, modifier) {
  let finalCodes = dedupeCodes(codes);
  if (modifier.reverse) {
    finalCodes = dedupeCodes(finalCodes.concat(finalCodes.map(reverseCode)));
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

function modifierFromToken(token, cfg) {
  const t = normalizeLatin(String(token || "").trim());
  if (t === "ABC") return { categories: ["A", "B"], reverse: true };
  if (t === "AB") return { categories: ["A", "B"], reverse: false };
  if (t === "A") return { categories: ["A"], reverse: false };
  if (t === "B") return { categories: ["B"], reverse: false };

  const resolved = resolveAlias(token, cfg);
  if (resolved === "A") return { categories: ["A"], reverse: false };
  if (resolved === "B") return { categories: ["B"], reverse: false };
  return null;
}

function findInlineModifier(line, cfg) {
  const tokens = line.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const mod = modifierFromToken(token, cfg);
    if (mod) return { token, modifier: mod };
  }

  // Attached 2-digit prefix, e.g. A01=20 / B01=20
  const m = line.match(/^([AB])(?=\d{2}(?:\D|$))/i);
  if (m) return { token: m[1], modifier: modifierFromToken(m[1], cfg), attached: true };

  return null;
}

function removeModifierToken(line, found) {
  if (!found) return line;
  if (found.attached) return line.slice(1);
  const escaped = found.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return line.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "i"), " ").trim();
}

function parseQuantityExpression(expr) {
  const s = String(expr || "").trim();
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
  // name/date metadata e.g. แป้ง 21-8-69
  if (/[\u0E00-\u0E7F]/u.test(t) && /\b\d{1,2}-\d{1,2}-\d{2,4}\b/.test(t)) return true;
  // common chat-only short acknowledgements
  if (/^(ขอบคุณ|ขอบคุณค่ะ|ขอบคุณครับ|รับทราบ|โอเค|ok)$/iu.test(t)) return true;
  return false;
}

function parseThreeDigitLine(line, cfg, acc, rules, errors) {
  let t = stripPoliteWords(normalizeLatin(line.trim()));

  let explicit = t.match(/^(\d{3})\s*=\s*(\d+)\s*\(\s*([EFG])\s*\)$/i);
  if (explicit) {
    acc.add(explicit[3].toUpperCase(), explicit[1], Number(explicit[2]));
    rules.add("R_3DIGIT_EXPLICIT_CATEGORY");
    return true;
  }

  const m = t.match(/^([AB])?(\d{3})\s*=\s*(\d+)(?:\s*[xX*]\s*(\d+))?$/i);
  if (!m) return false;

  const prefix = (m[1] || "").toUpperCase();
  const code = m[2];
  const q1 = Number(m[3]);
  const q2 = m[4] == null ? null : Number(m[4]);

  if (prefix === "B") {
    acc.add("G", code, q1);
    rules.add("R_3DIGIT_PREFIX_B_TO_G");
    return true;
  }

  if (q2 == null) {
    acc.add("E", code, q1);
    rules.add(prefix === "A" ? "R_3DIGIT_PREFIX_A_TO_E" : "R_3DIGIT_DEFAULT_E");
    return true;
  }

  // x1/x3/x6 are treated as permutation-count syntax.
  // Small values <= 6 that do not match the unique permutation count go to REVIEW.
  if (q2 <= 6) {
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

  // Otherwise interpret as E/F quantity pair.
  acc.add("E", code, q1);
  acc.add("F", code, q2);
  rules.add(prefix === "A" ? "R_3DIGIT_A_EF_PAIR" : "R_3DIGIT_EF_PAIR");
  return true;
}

function parseSpecialTwoDigitLine(line, cfg, acc, rules, errors) {
  const t = stripPoliteWords(normalizeLatin(line.trim()));

  // G = double-number set: 00,11,...99
  let m = t.match(/^G\s*=\s*(\d+)(?:\s*[xX*\/]\s*(\d+))?\s+(ABC|AB|A|B)$/i);
  if (m) {
    const q1 = Number(m[1]);
    const q2 = m[2] == null ? null : Number(m[2]);
    const mod = modifierFromToken(m[3], cfg);
    const codes = Array.from({ length: 10 }, (_, i) => `${i}${i}`);
    const quantitySpec = q2 == null
      ? { type: "SINGLE", first: q1 }
      : { type: "PAIR", first: q1, second: q2 };
    emitTwoDigitGroup(acc, codes, quantitySpec, mod);
    rules.add("R_G_DOUBLE_SET");
    return true;
  }

  // D7=20x20 => 70..79
  m = t.match(/^D([0-9])\s*=\s*(\d+)(?:\s*[xX*\/]\s*(\d+))?(?:\s+(ABC|AB|A|B))?$/i);
  if (m) {
    const digit = m[1];
    const q1 = Number(m[2]);
    const q2 = m[3] == null ? null : Number(m[3]);
    const explicitMod = m[4] ? modifierFromToken(m[4], cfg) : null;
    const mod = explicitMod || (q2 != null
      ? { categories: ["A", "B"], reverse: false }
      : { categories: ["A"], reverse: false });
    const codes = Array.from({ length: 10 }, (_, i) => `${digit}${i}`);
    const quantitySpec = q2 == null
      ? { type: "SINGLE", first: q1 }
      : { type: "PAIR", first: q1, second: q2 };
    emitTwoDigitGroup(acc, codes, quantitySpec, mod);
    rules.add("R_D_DECADE_SET");
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

    if (isMetadataLine(line)) continue;

    // Skip checksum line here; checksum handled at higher level.
    if (/^รวม\s+[A-Zก-๙]+\s+\d+$/iu.test(line)) continue;

    // Complete special expressions.
    if (parseSpecialTwoDigitLine(line, cfg, acc, rules, errors)) {
      pendingCodes = [];
      continue;
    }

    // Exact category header.
    const exactMod = modifierFromToken(line, cfg);
    if (exactMod) {
      contextModifier = exactMod;
      rules.add("R_CATEGORY_HEADER");
      continue;
    }

    // a5 / A5 / alias+qty after pending codes
    if (pendingCodes.length) {
      const aliasQty = line.match(/^([A-Za-z\u0E00-\u0E7F]+)\s*(\d+)$/u);
      if (aliasQty) {
        const cat = resolveAlias(aliasQty[1], cfg);
        if (cat === "A" || cat === "B") {
          emitTwoDigitGroup(
            acc,
            pendingCodes,
            { type: "SINGLE", first: Number(aliasQty[2]) },
            { categories: [cat], reverse: false }
          );
          pendingCodes = [];
          rules.add("R_ALIAS_QUANTITY");
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
    if (pendingCodes.length && isLast && /^\d+$/.test(line)) {
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

    let inline = findInlineModifier(line, cfg);
    let localModifier = inline ? inline.modifier : null;
    let working = removeModifierToken(line, inline);

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
      const qm = right.match(/^(\d+(?:\s*[xX*\/]\s*\d+)?)/);
      if (qm) quantitySpec = parseQuantityExpression(qm[1]);
    } else {
      // Inline pair at end: "01-05 AB 20x20" / "... 5*5"
      const qm = working.match(/(?:^|\s)(\d+\s*[xX*]\s*\d+)\s*$/);
      if (qm) {
        quantitySpec = parseQuantityExpression(qm[1]);
        codePart = working.slice(0, qm.index).trim();
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
      contextModifier = localModifier;
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

function parseOrder(inputText, config = {}) {
  const cfg = mergeConfig(config);
  const normalized = normalizeText(inputText);
  const acc = makeAccumulator();
  const rules = new Set();
  const warnings = [];
  const errors = [];
  const checksums = [];

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
  const segments = normalized.split(/\s+\/\s+/);

  for (const segmentRaw of segments) {
    const segment = segmentRaw.trim();
    if (!segment) continue;

    const lines = segment.split("\n");
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

      if (isMetadataLine(line)) continue;

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
    warnings,
    errors,
    checksums,
    parser_version: PARSER_VERSION,
    rule_ids: [...rules].sort(),
    normalized_text: normalized
  };
}

export { parseOrder, normalizeText, uniquePermutations, reverseCode, PARSER_VERSION };
