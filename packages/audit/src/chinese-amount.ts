/**
 * Reads the Chinese written form of a money amount.
 *
 * Every real contract states its total twice — once in figures and once in
 * words, as 壹佰玖拾捌万元整 — and the written form is the controlling one under
 * Chinese drafting convention. Comparing the two is only possible if the words
 * can be turned back into a number.
 *
 * Separate from `normalizeNumbers` in clause-numeric on purpose. That one is
 * deliberately permissive: it rewrites whatever looks like a numeral so a ratio
 * keyword can find a number nearby, and answers 3 for the malformed 壹贰叁.
 * Permissiveness is right for finding a number and wrong for asserting two
 * numbers disagree, where a bad parse manufactures a defect that is not in the
 * contract. This parser refuses anything it cannot read exactly.
 */

/**
 * Zero is handled before the digit table rather than in it: it holds a place
 * (壹佰零伍万) instead of contributing a value, so treating it as a digit would
 * make the following digit look like a second one in a row.
 */
const ZEROS = "零〇";

/** Financial (大写) digits and their everyday equivalents, which contracts mix freely. */
const DIGITS: Record<string, number> = {
  壹: 1,
  一: 1,
  贰: 2,
  二: 2,
  两: 2,
  叁: 3,
  三: 3,
  肆: 4,
  四: 4,
  伍: 5,
  五: 5,
  陆: 6,
  六: 6,
  柒: 7,
  七: 7,
  捌: 8,
  八: 8,
  玖: 9,
  九: 9,
};

/** Multipliers that scale the digit before them, within a 万/亿 section. */
const SCALES: Record<string, number> = { 拾: 10, 十: 10, 佰: 100, 百: 100, 仟: 1000, 千: 1000 };

/** Multipliers that close a section and scale everything accumulated in it. */
const SECTIONS: Record<string, number> = {
  万: 10_000,
  萬: 10_000,
  亿: 100_000_000,
  億: 100_000_000,
};

/** Sub-yuan units. 角 is a tenth, 分 a hundredth. */
const FRACTIONS: Record<string, number> = { 角: 0.1, 分: 0.01, 毛: 0.1 };

const CURRENCY_PREFIX = /^(?:人民币|RMB|¥|￥)/u;
const YUAN = /[元圆]/u;

/**
 * The characters a written amount may consist of. Used to find candidates in
 * running text before committing to a parse.
 */
const AMOUNT_CHARS = "零〇壹一贰二两叁三肆四伍五陆六柒七捌八玖九拾十佰百仟千万萬亿億元圆角分毛整正";

export const CHINESE_AMOUNT_PATTERN = new RegExp(`(?:人民币|RMB)?[${AMOUNT_CHARS}]{2,}`, "gu");

/**
 * Parses a written amount into yuan, or null when the text is not one.
 *
 * Returns null rather than a partial number for anything malformed: a contract
 * total read wrong is worse than a total reported unreadable, because the first
 * silently passes a reconciliation the parties never agreed to.
 */
export function parseChineseAmount(input: string): number | null {
  const text = input
    .trim()
    .replace(CURRENCY_PREFIX, "")
    .replace(/[整正]$/u, "");
  if (text.length === 0) return null;

  const yuanIndex = text.search(YUAN);
  const wholePart = yuanIndex === -1 ? text : text.slice(0, yuanIndex);
  const fractionPart = yuanIndex === -1 ? "" : text.slice(yuanIndex + 1);

  const whole = parseWholeYuan(wholePart);
  if (whole === null) return null;
  const fraction = parseFraction(fractionPart);
  if (fraction === null) return null;
  // 元 with nothing before it is a unit, not an amount.
  if (whole === 0 && fraction === 0 && !/[零〇]/u.test(wholePart)) return null;

  return Math.round((whole + fraction) * 100) / 100;
}

/** Accumulates the yuan part, flushing at each 万 / 亿 boundary. */
function parseWholeYuan(text: string): number | null {
  if (text.length === 0) return 0;

  let total = 0;
  let section = 0;
  let digit: number | null = null;
  /** Guards against a section multiplier smaller than one already applied. */
  let lastSectionScale = Number.POSITIVE_INFINITY;

  for (const char of text) {
    if (ZEROS.includes(char)) {
      digit = null;
      continue;
    }
    if (char in DIGITS) {
      // Two bare digits in a row (壹贰) is not a written amount; it is a digit
      // string someone spelled out, and guessing its magnitude would invent one.
      if (digit !== null) return null;
      digit = DIGITS[char];
      continue;
    }
    if (char in SCALES) {
      // A leading 拾 means ten, as in 拾万 — the elided 壹 is conventional.
      section += (digit ?? 1) * SCALES[char];
      digit = null;
      continue;
    }
    if (char in SECTIONS) {
      const scale = SECTIONS[char];
      if (scale >= lastSectionScale) return null;
      lastSectionScale = scale;
      const carried = section + (digit ?? 0);
      // 万 with nothing before it has no quantity to scale.
      if (carried === 0) return null;
      total += carried * scale;
      section = 0;
      digit = null;
      continue;
    }
    return null;
  }

  return total + section + (digit ?? 0);
}

/** Reads 角 / 分 into a fraction of a yuan. */
function parseFraction(text: string): number | null {
  if (text.length === 0) return 0;

  let total = 0;
  let digit: number | null = null;
  for (const char of text) {
    if (ZEROS.includes(char)) {
      digit = null;
      continue;
    }
    if (char in DIGITS) {
      if (digit !== null) return null;
      digit = DIGITS[char];
      continue;
    }
    if (char in FRACTIONS) {
      if (digit === null) return null;
      total += digit * FRACTIONS[char];
      digit = null;
      continue;
    }
    return null;
  }
  // A trailing digit with no unit is unreadable — 元伍 could be 5角 or 5分.
  return digit === null ? Math.round(total * 100) / 100 : null;
}
