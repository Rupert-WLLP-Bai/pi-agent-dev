import type { ContractDocument, EvidenceLocator, RuleParamSet } from "./model";

/**
 * Numeric and clause extraction shared by the procural risk rules.
 *
 * Chinese contracts write the same number three ways — `15%`, `百分之十五`,
 * `壹拾伍万元` — so every rule reads a normalized copy of the text and never
 * the raw block. Normalization is lossy by design (it re-writes numerals as
 * ASCII digits), which is why evidence is always anchored back to the original
 * block: a locator that pointed into the normalized string would name offsets
 * that do not exist in the Contract Document.
 *
 * The window discipline is the other half of the contract: a ratio rule only
 * trusts a number found within `CLAUSE_WINDOW` characters of its own keyword,
 * so a 30% prepayment term two clauses away can never be mistaken for an
 * over-limit performance bond.
 */

/** Characters of context a keyword looks through for its number. */
export const CLAUSE_WINDOW = 120;

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  "○": 0,
  一: 1,
  壹: 1,
  二: 2,
  贰: 2,
  两: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};

const CN_UNIT: Record<string, number> = {
  十: 10,
  拾: 10,
  百: 100,
  佰: 100,
  千: 1000,
  仟: 1000,
};

const CN_BIG: Record<string, number> = {
  万: 10_000,
  萬: 10_000,
  亿: 100_000_000,
  億: 100_000_000,
};

const CJK_NUMERAL_RUN = /[零〇○一二三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖两拾佰仟點点]+/gu;

function parseCjkInteger(sequence: string): number | null {
  if (sequence.length === 0) return 0;
  let result = 0;
  let section = 0;
  let number = 0;
  let seen = false;
  let hasDigitOrTen = false;
  for (const char of sequence) {
    const digit = CN_DIGIT[char];
    if (digit !== undefined) {
      number = digit;
      seen = true;
      hasDigitOrTen = true;
      continue;
    }
    const unit = CN_UNIT[char];
    if (unit !== undefined) {
      section += (number === 0 ? 1 : number) * unit;
      number = 0;
      seen = true;
      if (unit === 10) hasDigitOrTen = true;
      continue;
    }
    const big = CN_BIG[char];
    if (big !== undefined) {
      section = (section + number) * big;
      result += section;
      section = 0;
      number = 0;
      seen = true;
      continue;
    }
    return null;
  }
  // A run of only big units ("万" in "100万元") or only 百/千 ("百" in
  // "百分之") is a unit with no number attached, not a quantity.
  return seen && hasDigitOrTen ? result + section + number : null;
}

function parseCjkNumber(sequence: string): number | null {
  const [integerPart, decimalPart] = sequence.split(/[点點]/u);
  const integer = parseCjkInteger(integerPart ?? "");
  if (integer === null) return null;
  if (decimalPart === undefined) return integer;
  let value = integer;
  let scale = 0.1;
  for (const char of decimalPart) {
    const digit = CN_DIGIT[char];
    if (digit === undefined) return null;
    value += digit * scale;
    scale /= 10;
  }
  return value;
}

/** Full-width digits and punctuation to their ASCII forms; `％` becomes `%`. */
export function toHalfwidth(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/gu, " ");
}

/**
 * Rewrites every CJK numeral run as ASCII digits, so `百分之十五` reads as
 * `百分之15` and `壹拾贰万元` as `120000元`. A run that fails to parse (e.g. a
 * lone `点` in ordinary prose) is left untouched.
 */
export function normalizeNumbers(text: string): string {
  // The 百 in 百分之 is the percent marker, not the number one hundred.
  const PERCENT_MARKER = "\u0000%";
  return text
    .replace(/百分之/gu, PERCENT_MARKER)
    .replace(CJK_NUMERAL_RUN, (run) => {
      const value = parseCjkNumber(run);
      return value === null ? run : String(value);
    })
    .replace(new RegExp(PERCENT_MARKER, "gu"), "百分之");
}

/** The canonical normalized form every extractor below reads. */
export function normalizeClauseText(text: string): string {
  return normalizeNumbers(toHalfwidth(text));
}

export interface RatioMatch {
  /** The ratio as a 0–1 fraction (20% → 0.2). */
  ratio: number;
  raw: string;
}

/** `成` is a tenth, so its value is divided by 10 rather than 100. */
const RATIO_PATTERNS: Array<{ pattern: RegExp; perTen: boolean }> = [
  { pattern: /([0-9]+(?:\.[0-9]+)?)\s*[%]/u, perTen: false },
  { pattern: /百分之\s*([0-9]+(?:\.[0-9]+)?)/u, perTen: false },
  { pattern: /([0-9]+(?:\.[0-9]+)?)\s*成/u, perTen: true },
];

/** First percentage in the text: `15%`, `百分之十五`, or `两成`. */
export function extractRatio(text: string): RatioMatch | null {
  for (const { pattern, perTen } of RATIO_PATTERNS) {
    const match = pattern.exec(text);
    if (match === null) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    return { ratio: perTen ? value / 10 : value / 100, raw: match[0] };
  }
  return null;
}

export interface MoneyMatch {
  /** Amount in yuan. */
  amount: number;
  raw: string;
}

const MONEY_PATTERN = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(亿元|万元|万|元)/u;
const MONEY_MULTIPLIER: Record<string, number> = {
  亿元: 100_000_000,
  万元: 10_000,
  万: 10_000,
  元: 1,
};

/** First money amount in the text, in yuan. */
export function extractMoney(text: string): MoneyMatch | null {
  const match = MONEY_PATTERN.exec(text);
  if (match === null) return null;
  const value = Number(match[1].replace(/,/gu, ""));
  if (!Number.isFinite(value)) return null;
  return { amount: value * (MONEY_MULTIPLIER[match[2]] ?? 1), raw: match[0] };
}

export interface DurationMatch {
  /** Duration in natural days: 月 → ×30, 工作日 → ×7/5. */
  days: number;
  /** Whole months when the unit was 月; otherwise 0. */
  months: number;
  /** Fractional years for 年/月 units; 0 otherwise. */
  years: number;
  unit: string;
  raw: string;
}

const DURATION_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*(个?月|个?工作日|年|日|天)/gu;

/** First duration in the text, normalised to natural days. */
export function extractDuration(text: string): DurationMatch | null {
  // A calendar date ("2026年10月31日") is not a duration, and its 10月/31日
  // fragments must not be read as ten months or thirty-one days.
  const dateFree = text
    .replace(/\d{4}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?/gu, " ")
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日/gu, " ");
  DURATION_PATTERN.lastIndex = 0;
  let match = DURATION_PATTERN.exec(dateFree);
  while (match !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    // A bare year above 50 is a calendar date ("2026年"), not a duration.
    if (unit === "年" && value > 50) {
      match = DURATION_PATTERN.exec(dateFree);
      continue;
    }
    if (unit.includes("月")) {
      return {
        days: value * 30,
        months: Math.round(value),
        years: value / 12,
        unit,
        raw: match[0],
      };
    }
    if (unit.includes("工作日")) {
      return { days: (value * 7) / 5, months: 0, years: 0, unit, raw: match[0] };
    }
    if (unit === "年") {
      return { days: value * 365, months: value * 12, years: value, unit, raw: match[0] };
    }
    return { days: value, months: 0, years: 0, unit, raw: match[0] };
  }
  return null;
}

export interface ClauseHit {
  blockId: string;
  text: string;
  /** Normalized window of `CLAUSE_WINDOW` characters around the keyword. */
  window: string;
  keyword: string;
  /** Code-point index of the keyword in the original block text. */
  keywordStart: number;
  keywordLength: number;
}
function windowAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - CLAUSE_WINDOW);
  const end = Math.min(text.length, index + length + CLAUSE_WINDOW);
  return text.slice(start, end);
}

/**
 * First block whose original text matches the keyword, with a normalized
 * window around the hit. One hit per block keeps a rule from re-reading the
 * same clause through every occurrence of its keyword.
 */
export function findClause(document: ContractDocument, keyword: RegExp): ClauseHit | null {
  for (const block of document.blocks) {
    const original = block.text;
    keyword.lastIndex = 0;
    const match = keyword.exec(original);
    if (match === null) continue;
    const normalized = normalizeClauseText(original);
    keyword.lastIndex = 0;
    const normalizedMatch = keyword.exec(normalized);
    const center = normalizedMatch?.index ?? match.index;
    const length = normalizedMatch?.[0].length ?? match[0].length;
    return {
      blockId: block.blockId,
      text: original,
      window: windowAround(normalized, center, length),
      keyword: match[0],
      keywordStart: Array.from(original.slice(0, match.index)).length,
      keywordLength: Array.from(match[0]).length,
    };
  }
  return null;
}

export function hasKeyword(document: ContractDocument, keyword: RegExp): boolean {
  return document.blocks.some((block) => {
    keyword.lastIndex = 0;
    return keyword.test(block.text);
  });
}

/**
 * First money amount stated near a denominator keyword anywhere in the
 * document — the contract total, the winning bid amount, the settled price.
 * Returns null when the contract never states one, which is the signal a
 * ratio rule degrades on instead of guessing a denominator.
 */
export function findMoneyNear(
  document: ContractDocument,
  keyword: RegExp,
  radius = CLAUSE_WINDOW,
): MoneyMatch | null {
  for (const block of document.blocks) {
    keyword.lastIndex = 0;
    const match = keyword.exec(block.text);
    if (match === null) continue;
    const normalized = normalizeClauseText(block.text);
    // The amount follows its label ("合同总价为 150 万元"), so read forward
    // first; only fall back to the text before the label when nothing follows.
    const end = match.index + match[0].length;
    const after = normalized.slice(end, end + radius);
    const before = normalized.slice(Math.max(0, match.index - radius), match.index);
    const money = extractMoney(after) ?? extractMoney(before);
    if (money !== null) return money;
  }
  return null;
}

/**
 * Evidence anchored to the clause that produced a rule's number. The span
 * always points into the ORIGINAL block text (pad characters around the
 * keyword), never the normalized copy.
 */
export function clauseEvidence(input: {
  id: string;
  sourceRecordId: string;
  document: ContractDocument;
  hit: ClauseHit;
  pad?: number;
}): EvidenceLocator {
  return spanEvidence({
    id: input.id,
    sourceRecordId: input.sourceRecordId,
    document: input.document,
    blockId: input.hit.blockId,
    index: input.hit.keywordStart,
    length: input.hit.keywordLength,
    ...(input.pad === undefined ? {} : { pad: input.pad }),
  });
}

/**
 * A span anchored to a real offset in a block. `index` and `length` are
 * code-point counts into the original text, matching how the IR measures
 * offsets, so the quoted text is always a faithful slice of the document.
 */
export function spanEvidence(input: {
  id: string;
  sourceRecordId: string;
  document: ContractDocument;
  blockId: string;
  index: number;
  length: number;
  pad?: number;
}): EvidenceLocator {
  const block = input.document.blocks.find((item) => item.blockId === input.blockId);
  const chars = Array.from(block?.text ?? "");
  const pad = input.pad ?? 24;
  const start = Math.max(0, input.index - pad);
  const end = Math.min(chars.length, input.index + input.length + pad);
  return {
    id: input.id,
    sourceRecordId: input.sourceRecordId,
    location: {
      kind: "DOCUMENT_SPAN",
      contractDocumentHash: input.document.hash,
      blockId: input.blockId,
      startOffset: start,
      endOffset: end,
      quotedText: chars.slice(start, end).join(""),
    },
  };
}

/** Reads a numeric rule parameter, falling back to the catalogue default. */
export function numberParam(
  params: RuleParamSet | undefined,
  key: string,
  fallback: number,
): number {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Reads a boolean rule parameter, falling back to the catalogue default. */
export function booleanParam(
  params: RuleParamSet | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const value = params?.[key];
  return typeof value === "boolean" ? value : fallback;
}

/** Formats a 0–1 ratio as a whole/half percentage for the basis sentence. */
export function formatRatio(ratio: number): string {
  const percent = ratio * 100;
  return Number.isInteger(percent) ? `${percent}%` : `${Math.round(percent * 100) / 100}%`;
}
