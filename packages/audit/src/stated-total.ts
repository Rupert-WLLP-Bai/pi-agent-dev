import { buildAmountInWordsFacts } from "./amount-words-rule";
import { toHalfwidth } from "./clause-numeric";
import type { ContractDocument } from "./document-ir";

/**
 * Reads the project total a contract states, so it can be checked against the
 * spreadsheet it was priced from.
 *
 * Contracts state the total in two unrelated shapes, and a dossier holds both.
 * The revenue contract writes it as prose — 最大发生金额为（含税价）人民币大写
 * 【壹佰玖拾捌万】元整，小写【1980000】元 — while the procurement contract puts it in
 * a 第四条 price table whose numbers carry no 元 at all, because the unit lives in
 * the column header 不含税价格（元）. Reading only the prose form would leave every
 * procurement contract unchecked.
 */

/** One total a contract states, with the block it was read from. */
export interface StatedTotal {
  blockId: string;
  amount: number;
  /** Null when the contract does not say which basis this figure is on. */
  taxIncluded: boolean | null;
  /** How it was read, for a reviewer who wants to disagree with the reading. */
  basis: string;
}

/** Numbers written plainly, as a table states them: 1759600, 1,865,176, 0.16. */
const BARE_NUMBER = /[0-9][0-9,]*(?:\.[0-9]+)?/gu;
const PERCENT = /([0-9]+(?:\.[0-9]+)?)\s*%/gu;
const PRICE_TABLE = /不含税(?:价格|金额|价|单价)/u;

/**
 * A total rounded to the nearest yuan is still the same total. Contracts round
 * the tax-inclusive figure either way — 1,759,600 × 1.06 lands exactly, but
 * a rate applied to an odd base does not — so the pair is matched to within
 * half a yuan rather than exactly.
 */
const ROUNDING_TOLERANCE = 0.5;

const taxBasisOf = (text: string): boolean | null => {
  // 不含税 contains 含税, so the negative form has to be tested first.
  if (text.includes("不含税")) return false;
  if (text.includes("含税")) return true;
  return null;
};

/** Every distinct tax rate the text states, as a 0–1 fraction. */
function ratesIn(text: string): number[] {
  const rates = new Set<number>();
  PERCENT.lastIndex = 0;
  for (const match of text.matchAll(PERCENT)) {
    const rate = Number(match[1]) / 100;
    // A penalty clause writes 20%; a VAT rate is single-digit. Above that the
    // number is not a tax rate and pairing on it would invent a total.
    if (rate > 0 && rate <= 0.2) rates.add(rate);
  }
  return [...rates];
}

/** Numbers in the text, minus the ones that are percentages. */
function amountsIn(text: string): number[] {
  const percentSpans: Array<[number, number]> = [];
  PERCENT.lastIndex = 0;
  for (const match of text.matchAll(PERCENT)) {
    const at = match.index ?? 0;
    percentSpans.push([at, at + match[0].length]);
  }

  const amounts: number[] = [];
  BARE_NUMBER.lastIndex = 0;
  for (const match of text.matchAll(BARE_NUMBER)) {
    const at = match.index ?? 0;
    if (percentSpans.some(([start, end]) => at >= start && at < end)) continue;
    const value = Number(match[0].replace(/,/gu, ""));
    if (Number.isFinite(value)) amounts.push(value);
  }
  return amounts;
}

/**
 * The tax-exclusive and tax-inclusive totals a price table states, found by the
 * table's own arithmetic.
 *
 * The pair is identified by the tax rate rather than by position or magnitude:
 * two numbers where one is the other grossed up by the stated rate are the same
 * price on both bases. That is what makes the reading trustworthy — it verifies
 * the contract's own arithmetic instead of assuming a column order the flattened
 * table no longer has.
 *
 * A line-item table satisfies the relation once per line, so a table is only
 * read when exactly one pair holds. Anything else is a table this cannot claim
 * to understand.
 */
function pairByTaxRate(text: string): { exclusive: number; inclusive: number } | null {
  const rates = ratesIn(text);
  if (rates.length === 0) return null;
  const amounts = amountsIn(text);

  const pairs: Array<{ exclusive: number; inclusive: number }> = [];
  for (const rate of rates) {
    for (const exclusive of amounts) {
      // A total is not a unit price; pairing on 0.16 → 0.1696 would read a rate
      // card as the project price.
      if (exclusive < 1) continue;
      for (const inclusive of amounts) {
        if (inclusive <= exclusive) continue;
        if (Math.abs(inclusive - exclusive * (1 + rate)) > ROUNDING_TOLERANCE) continue;
        pairs.push({ exclusive, inclusive });
      }
    }
  }

  const distinct = pairs.filter(
    (pair, index) =>
      pairs.findIndex(
        (other) => other.exclusive === pair.exclusive && other.inclusive === pair.inclusive,
      ) === index,
  );
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * Every total the contract states, prose form first.
 *
 * Both forms are returned rather than one, because a contract that states the
 * price on both tax bases states two facts and the spreadsheet holds both. The
 * caller matches whichever the sheet can account for instead of guessing which
 * basis a clause meant.
 */
export function readStatedTotals(document: ContractDocument): StatedTotal[] {
  const totals: StatedTotal[] = [];

  // The prose form is the contract's own headline figure, written twice for
  // exactly the purpose of being unambiguous, so it is read first.
  const words = buildAmountInWordsFacts({ sourceRecordId: "stated-total", document });
  const anchor = words.evidence[0]?.location;
  if (words.facts.words !== null && anchor?.kind === "DOCUMENT_SPAN") {
    const block = document.blocks.find((candidate) => candidate.blockId === anchor.blockId);
    totals.push({
      blockId: anchor.blockId,
      amount: words.facts.words,
      taxIncluded: taxBasisOf(toHalfwidth(block?.text ?? "")),
      basis: `合同以大小写载明总额 ${words.facts.wordsRaw ?? ""}`.trim(),
    });
  }

  for (const block of document.blocks) {
    const text = toHalfwidth(block.text);
    if (!PRICE_TABLE.test(text)) continue;
    const pair = pairByTaxRate(text);
    if (pair === null) continue;
    const rate = Math.round((pair.inclusive / pair.exclusive - 1) * 10000) / 100;
    totals.push(
      {
        blockId: block.blockId,
        amount: pair.exclusive,
        taxIncluded: false,
        basis: `价格表载明不含税 ${pair.exclusive}，按 ${rate}% 税率与含税 ${pair.inclusive} 自洽`,
      },
      {
        blockId: block.blockId,
        amount: pair.inclusive,
        taxIncluded: true,
        basis: `价格表载明含税 ${pair.inclusive}，按 ${rate}% 税率与不含税 ${pair.exclusive} 自洽`,
      },
    );
  }

  return totals.filter(
    (total, index) =>
      totals.findIndex(
        (other) => other.amount === total.amount && other.taxIncluded === total.taxIncluded,
      ) === index,
  );
}
