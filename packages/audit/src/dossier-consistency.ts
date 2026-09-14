import type { ContractStance } from "./contract-stance";

/**
 * Reconciles the amounts a project dossier states in more than one place.
 *
 * An ICT project models its money in a spreadsheet, then signs two contracts off
 * it — one earning revenue from the customer, one paying a supplier. The three
 * documents have to agree, and nobody checks that they do: in the real 天翼五期
 * dossier the revenue contract's 1,980,000 has to equal the customer-side total
 * in 收入测算, and the procurement contract's 1,759,600 / 1,865,176 the
 * supplier-side ones. A single stale cell breaks the chain silently, because each
 * document is internally consistent.
 *
 * This module owns only the reconciliation. Which files belong to one dossier,
 * and how they are stored, is the caller's concern.
 */

/** Whose money a total is: what we bill, or what we owe. */
export type AmountSide = "customer" | "supplier";

/** One total a spreadsheet states, with the address it is cited by. */
export interface SheetTotal {
  sheet: string;
  ref: string;
  /** The column header the total sits under, e.g. 客户侧含税总价. */
  label: string;
  side: AmountSide | null;
  /** Null when the label does not say. 不含税 and 含税 are different facts. */
  taxIncluded: boolean | null;
  amount: number;
  /** Whether the sheet computed it. A hand-typed total is the one to distrust. */
  derived: boolean;
}

/** The subset of a parsed spreadsheet cell this module reads. */
export interface ReadableCell {
  sheet: string;
  ref: string;
  row: number;
  column: number;
  text: string;
  numeric: number | null;
  formula: string | null;
  sharedWith: string | null;
}

const SUM_FORMULA = /^\s*SUM\s*\(/iu;
const TOTAL_LABEL = /合计|小计|总价|总额|总计/u;
const CUSTOMER_LABEL = /客户|甲方|收入/u;
const SUPPLIER_LABEL = /供应商|供方|下家|采购|成本/u;

const sideOf = (label: string): AmountSide | null => {
  // Supplier first: 供应商侧收入 names the supplier, not our revenue.
  if (SUPPLIER_LABEL.test(label)) return "supplier";
  if (CUSTOMER_LABEL.test(label)) return "customer";
  return null;
};

const taxOf = (label: string): boolean | null => {
  // 不含税 contains 含税, so the negative form has to be tested first.
  if (label.includes("不含税")) return false;
  if (label.includes("含税")) return true;
  return null;
};

/**
 * The header a total sits under: the nearest text-only cell above it in the same
 * column.
 *
 * A real price sheet repeats its header for each scenario block — 收入测算 has
 * one at row 1, another at row 11, another at row 23 — so the nearest header
 * above is the one that describes this total. Taking the first header in the
 * sheet would label every later block with the first block's columns.
 */
function headerAbove(cells: readonly ReadableCell[], total: ReadableCell): ReadableCell | null {
  let best: ReadableCell | null = null;
  for (const cell of cells) {
    if (cell.sheet !== total.sheet || cell.column !== total.column) continue;
    if (cell.row >= total.row) continue;
    if (cell.numeric !== null || cell.text.length === 0) continue;
    if (best === null || cell.row > best.row) best = cell;
  }
  return best;
}

/**
 * Whose side a column belongs to, read off the group it was filed under.
 *
 * 收入测算 names the side once per group of columns and lets the rest inherit it:
 * 客户侧不含税单价, 客户侧含税单价, 不含税总价, 含税总价, then 供应商不含税单价 and
 * the same two totals again. The totals themselves never say whose they are, so
 * the side is the nearest qualifier to their left in the same header row — the
 * one that opened their group.
 */
function sideFromGroup(cells: readonly ReadableCell[], header: ReadableCell): AmountSide | null {
  let best: { column: number; side: AmountSide } | null = null;
  for (const cell of cells) {
    if (cell.sheet !== header.sheet || cell.row !== header.row) continue;
    if (cell.column > header.column) continue;
    const side = sideOf(cell.text);
    if (side === null) continue;
    if (best === null || cell.column > best.column) best = { column: cell.column, side };
  }
  return best?.side ?? null;
}

const isSum = (cell: ReadableCell): boolean =>
  cell.formula !== null && SUM_FORMULA.test(cell.formula);

const rowKey = (cell: ReadableCell): string => `${cell.sheet}:${cell.row}`;

/**
 * What each row calls itself: its leftmost text cell.
 *
 * Only the leftmost one, because a header row names columns rather than itself.
 * 收入测算 repeats a header reading 接口名称 … 不含税总价 含税总价; reading any text
 * cell on the row would let 总价 declare the header row a totals row, and the
 * unrelated scratch numbers parked to its right would become totals.
 */
function rowLabels(cells: readonly ReadableCell[]): Map<string, string> {
  const leftmost = new Map<string, ReadableCell>();
  for (const cell of cells) {
    if (cell.numeric !== null || cell.text.length === 0) continue;
    const current = leftmost.get(rowKey(cell));
    if (current === undefined || cell.column < current.column) leftmost.set(rowKey(cell), cell);
  }
  return new Map([...leftmost].map(([key, cell]) => [key, cell.text]));
}

/**
 * The totals a spreadsheet states.
 *
 * Totalness belongs to the row, not the column. A column headed 含税总价 holds a
 * line total on every row — quantity times unit price — so reading the header as
 * the signal would make each product line a dossier-level total. Two kinds of
 * row carry one:
 *
 * A row labelled 合计 declares itself, and every number on it is a total. A row
 * the sheet summed declares itself too, but its other numbers need not be
 * totals: 收入测算 puts the margin rate F20/J20-1 beside the four SUMs. Those
 * rows are read column by column, keeping the cells whose header names an
 * amount, which is how a reader tells 1,960,000 under 含税总价 from 0.0615 under
 * nothing.
 *
 * The second case is what makes the hand-typed total visible. 收入测算 row 9 sums
 * only its first column and leaves the other three typed in; they agree today,
 * and nothing keeps them agreeing.
 */
export function extractSheetTotals(cells: readonly ReadableCell[]): SheetTotal[] {
  const labels = rowLabels(cells);
  const summedRows = new Set<string>();
  for (const cell of cells) {
    if (isSum(cell)) summedRows.add(rowKey(cell));
  }

  const totals: SheetTotal[] = [];
  for (const cell of cells) {
    if (cell.numeric === null) continue;
    const rowLabel = labels.get(rowKey(cell)) ?? "";
    const declared = TOTAL_LABEL.test(rowLabel);
    if (!declared && !summedRows.has(rowKey(cell))) continue;

    const header = headerAbove(cells, cell);
    const headerText = header?.text ?? "";
    if (!declared && !isSum(cell) && !TOTAL_LABEL.test(headerText)) continue;

    // The header names the quantity, the row label names the line, and either
    // may be the one that says 客户侧 or 含税.
    const label = [headerText, rowLabel].filter((part) => part.length > 0).join(" · ");
    totals.push({
      sheet: cell.sheet,
      ref: cell.ref,
      label,
      side: sideOf(label) ?? (header === null ? null : sideFromGroup(cells, header)),
      taxIncluded: taxOf(label),
      amount: cell.numeric,
      derived: cell.formula !== null || cell.sharedWith !== null,
    });
  }

  return totals;
}

/** The total one contract states, as read off its own text. */
export interface ContractTotal {
  /** The artifact this came from, for the finding to name. */
  artifactName: string;
  /** Block the amount was read from, so the finding can anchor to it. */
  blockId: string;
  amount: number;
  stance: ContractStance;
  /** Null when the contract does not say; then tax is not used to narrow. */
  taxIncluded: boolean | null;
}

export type Reconciliation =
  | { status: "MATCHED"; contract: ContractTotal; matched: SheetTotal }
  | {
      status: "MISMATCHED";
      contract: ContractTotal;
      /** The closest candidate, which is what the finding reports against. */
      nearest: SheetTotal;
      difference: number;
      candidates: SheetTotal[];
    }
  | { status: "NO_CANDIDATE"; contract: ContractTotal; reason: string };

/** A revenue contract bills the customer; a procurement contract pays a supplier. */
const sideForStance = (stance: ContractStance): AmountSide =>
  stance === "revenue" ? "customer" : "supplier";

/**
 * Checks one contract's total against the spreadsheet totals on its own side.
 *
 * The stance decides which side to compare against, and that is the whole point:
 * a revenue contract measured against a supplier-side total would report the
 * project's margin as a discrepancy. Tax basis narrows further when both say,
 * because 不含税 1,759,600 and 含税 1,865,176 are both correct and only one of
 * them is what a given clause states.
 */
export function reconcileContractTotal(input: {
  contract: ContractTotal;
  totals: readonly SheetTotal[];
}): Reconciliation {
  const { contract } = input;
  const side = sideForStance(contract.stance);
  const onSide = input.totals.filter((total) => total.side === side);
  if (onSide.length === 0) {
    return {
      status: "NO_CANDIDATE",
      contract,
      reason: `测算表中没有${side === "customer" ? "客户侧" : "供应商侧"}的合计金额，无法与${contract.stance === "revenue" ? "收入" : "支出"}合同核对`,
    };
  }

  // Narrowing by tax basis only helps when both sides state one; a contract
  // that is silent must be compared against every candidate rather than none.
  const byTax =
    contract.taxIncluded === null
      ? onSide
      : onSide.filter(
          (total) => total.taxIncluded === null || total.taxIncluded === contract.taxIncluded,
        );
  const candidates = byTax.length > 0 ? byTax : onSide;

  // A cent is below the precision either document expresses.
  const matched = candidates.find((total) => Math.abs(total.amount - contract.amount) < 0.01);
  if (matched !== undefined) return { status: "MATCHED", contract, matched };

  const nearest = candidates.reduce((closest, total) =>
    Math.abs(total.amount - contract.amount) < Math.abs(closest.amount - contract.amount)
      ? total
      : closest,
  );
  return {
    status: "MISMATCHED",
    contract,
    nearest,
    difference: Math.round((contract.amount - nearest.amount) * 100) / 100,
    candidates,
  };
}

/** What a review of one dossier's amount chain checked, and what it found. */
export interface AmountChainReport {
  /** How many contract-to-sheet comparisons were made. */
  checked: number;
  matched: Reconciliation[];
  mismatched: Reconciliation[];
  unchecked: Reconciliation[];
  /**
   * Totals a sheet typed in by hand where the sheet could have summed them.
   * Not a mismatch — a number nobody's arithmetic stands behind.
   */
  handEnteredTotals: SheetTotal[];
}

export function reviewAmountChain(input: {
  contracts: readonly ContractTotal[];
  totals: readonly SheetTotal[];
}): AmountChainReport {
  const results = input.contracts.map((contract) =>
    reconcileContractTotal({ contract, totals: input.totals }),
  );
  return {
    checked: results.filter((result) => result.status !== "NO_CANDIDATE").length,
    matched: results.filter((result) => result.status === "MATCHED"),
    mismatched: results.filter((result) => result.status === "MISMATCHED"),
    unchecked: results.filter((result) => result.status === "NO_CANDIDATE"),
    handEnteredTotals: input.totals.filter((total) => !total.derived),
  };
}
