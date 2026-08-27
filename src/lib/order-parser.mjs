"use strict";

/**
 * LINE Order Parser v1.5.0
 * Pure JavaScript, no external dependencies.
 *
 * Design goals:
 * - deterministic parser: same input + config => same output
 * - independent from Google Sheets / Make / database
 * - configurable category aliases
 * - REVIEW instead of guessing when grammar is ambiguous
 */

const PARSER_VERSION = "1.5.2";

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
  if (m && isPermuteAllCommand(m[2], cfg)) {
    return { kind: "PERMUTE_ALL", quantity: Number(m[1]) };
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

  // Natural 3-digit category suffix, e.g. "639 100 โต๊ด" => F639=100.
  // TOP/BOTTOM are contextual: บน/บ => E for 3 digits, ล่าง/ล => G.
  let natural = t.match(/^(\d{3})\s+(\d+)\s+(.+)$/u);
  if (natural) {
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
  if (natural && isThreeDigitPermuteMarker(natural[2], cfg)) {
    const codes = dedupeCodes(natural[1].split(/[\s,/:.]+/u).filter(Boolean));
    emitThreeDigitPermutations(acc, codes, Number(natural[3]), "E");
    rules.add("R_3DIGIT_NATURAL_PERMUTE");
    return true;
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

function parseSweepTwoDigitLine(line, cfg, acc, rules) {
  const t = stripPoliteWords(normalizeLatin(line.trim()));
  const excluded = stripExcludeDoublePhrase(t);
  const clean = excluded.text;

  // Longest/specific generator first: "รูดเบิ้ล" must never be consumed as "รูด".
  const doubleLead = matchLeadingAlias(clean, cfg, "DOUBLE");
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

    if (isMetadataLine(line)) continue;

    // Skip checksum line here; checksum handled at higher level.
    if (/^รวม\s+[A-Zก-๙]+\s+\d+$/iu.test(line)) continue;

    // Natural sweep shorthand and complete special expressions.
    if (parseSweepTwoDigitLine(line, cfg, acc, rules)) {
      pendingCodes = [];
      continue;
    }
    if (parseSpecialTwoDigitLine(line, cfg, acc, rules, errors)) {
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

    // Real-chat colon shorthand:
    // 10\n01\n33:200:200 => A/B 10,01,33 = 200/200
    // บน\n06:200        => A06 = 200
    // ล่าง\n60:200      => B60 = 200
    const colonPair = working.match(/^(\d{2})\s*:\s*(\d+)\s*[:;]\s*(\d+)$/u);
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
          delimiter: working.includes(";") ? ";" : ":"
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
      const qm = right.match(/^(\d+(?:\s*[xX*\/]\s*\d+)?)/);
      if (qm) quantitySpec = parseQuantityExpression(qm[1]);
    } else {
      // Inline pair at end: "01-05 AB 20x20" / "... 5*5"
      let qm = working.match(/(?:^|\s)(\d+\s*[xX*]\s*\d+)\s*$/);
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

  // Clearly aggregate/reporting text sent back into the LINE group.
  // This must be narrow: never ignore merely because a line contains "รวม".
  if (/^รวม\s+[23]\s*ตัว(?:ตรง|โต๊ด|บน|ล่าง)\s+[\d,]+(?:\.\d+)?$/iu.test(text)) {
    return true;
  }

  return /^(?:สรุป(?:ยอด)?|ยอดรวม|รวมยอด|ยอดวันนี้|ยอดปัจจุบัน|รวมตรง|รวมวิ่ง|รวมทั้งหมด)(?:\s|[:|]|$)/iu.test(text);
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

      if (isMetadataLine(line)) continue;
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

  // Never silently discard text that strongly looks like an order. If grammar is
  // not recognized, route it to Review instead of returning IGNORE.
  const hasOrderLikeWarning = warnings.some((warning) => warning.code === "UNRECOGNIZED_ORDER_LIKE_TEXT");
  const stronglyOrderLike =
    /\d{2,3}(?:[\s,./:\-]+\d{2,3})*\s*(?:\n\s*)?=/u.test(normalized) ||
    /^\s*\d{3}(?:[\s,./:]+\d{3})*\s+\d+\s+\S+/mu.test(normalized) ||
    /^\s*\d{3}(?:[\s,./:]+\d{3})*\s+\S+\s+\d+\s*$/mu.test(normalized) ||
    /^\s*(?:[HL]|วิ่งบน|วิ่งล่าง|วิ่ง\s*[บล])\s*\d(?:[\s,./:]+\d)*\s*=\s*\d+/miu.test(normalized);
  if (hasOrderLikeWarning && stronglyOrderLike) {
    const details = warnings
      .filter((warning) => warning.code === "UNRECOGNIZED_ORDER_LIKE_TEXT")
      .map((warning) => warning.detail)
      .filter(Boolean);
    errors.push({
      code: "UNRECOGNIZED_ORDER_SYNTAX",
      detail: details.length ? details.join(" | ") : normalized
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
    warnings,
    errors,
    checksums,
    parser_version: PARSER_VERSION,
    rule_ids: [...rules].sort(),
    normalized_text: normalized
  };
}

export { parseOrder, normalizeText, uniquePermutations, reverseCode, PARSER_VERSION };
