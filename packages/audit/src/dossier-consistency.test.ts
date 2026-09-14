import { expect, test } from "bun:test";
import {
  type ContractTotal,
  extractSheetTotals,
  type ReadableCell,
  reconcileContractTotal,
  reviewAmountChain,
} from "./dossier-consistency";

const cell = (
  ref: string,
  row: number,
  column: number,
  value: string | number,
  formula: string | null = null,
): ReadableCell => ({
  sheet: "Sheet1",
  ref,
  row,
  column,
  text: String(value),
  numeric: typeof value === "number" ? value : null,
  formula,
  sharedWith: null,
});

/**
 * The real 收入测算（天翼数智五）shape, reduced: a customer side and a supplier
 * side under one header row, with SUM totals beneath and a margin derived from
 * both.
 */
const REVENUE_MODEL: ReadableCell[] = [
  cell("A1", 1, 1, "产品列表"),
  cell("E1", 1, 5, "客户侧不含税总价"),
  cell("F1", 1, 6, "客户侧含税总价"),
  cell("I1", 1, 9, "供应商不含税总价"),
  cell("J1", 1, 10, "供应商含税总价"),
  cell("A2", 2, 1, "二要素核验服务"),
  cell("E2", 2, 5, 1_867_924.53),
  cell("F2", 2, 6, 1_980_000),
  cell("I2", 2, 9, 1_759_600),
  cell("J2", 2, 10, 1_865_176),
  cell("A20", 20, 1, "合计"),
  cell("E20", 20, 5, 1_867_924.53, "SUM(E2:E19)"),
  cell("F20", 20, 6, 1_980_000, "SUM(F2:F19)"),
  cell("I20", 20, 9, 1_759_600, "SUM(I2:I19)"),
  cell("J20", 20, 10, 1_865_176, "SUM(J2:J19)"),
];

const revenueContract: ContractTotal = {
  artifactName: "【收入合同】天翼数智（五期）.docx",
  blockId: "p-37",
  amount: 1_980_000,
  stance: "revenue",
  taxIncluded: true,
};

const procurementContract: ContractTotal = {
  artifactName: "天翼五期合作合同（元通）.docx",
  blockId: "p-58",
  amount: 1_759_600,
  stance: "procurement",
  taxIncluded: false,
};

test("a SUM cell becomes a total labelled by the column it sits under", () => {
  const totals = extractSheetTotals(REVENUE_MODEL);

  const customerTaxed = totals.find((total) => total.ref === "F20");
  expect(customerTaxed?.amount).toBe(1_980_000);
  expect(customerTaxed?.side).toBe("customer");
  expect(customerTaxed?.taxIncluded).toBe(true);
  expect(customerTaxed?.derived).toBe(true);

  const supplierUntaxed = totals.find((total) => total.ref === "I20");
  expect(supplierUntaxed?.side).toBe("supplier");
  expect(supplierUntaxed?.taxIncluded).toBe(false);
});

test("不含税 is read as excluding tax, not as including it", () => {
  const totals = extractSheetTotals(REVENUE_MODEL);

  // 不含税 contains 含税, so a naive test would call every column tax-inclusive
  // and reconcile 1,759,600 against 1,865,176.
  expect(totals.find((total) => total.ref === "E20")?.taxIncluded).toBe(false);
  expect(totals.find((total) => total.ref === "F20")?.taxIncluded).toBe(true);
});

test("each scenario block's totals take the header directly above them", () => {
  // A real price sheet repeats its header per scenario; taking the sheet's first
  // header would label the second block with the first block's columns.
  const twoBlocks: ReadableCell[] = [
    cell("F1", 1, 6, "客户侧含税总价"),
    cell("F5", 5, 6, 1_990_000, "SUM(F2:F4)"),
    cell("F8", 8, 6, "供应商含税总价"),
    cell("F12", 12, 6, 1_716_140, "SUM(F9:F11)"),
  ];

  const totals = extractSheetTotals(twoBlocks);

  expect(totals.find((total) => total.ref === "F5")?.side).toBe("customer");
  expect(totals.find((total) => total.ref === "F12")?.side).toBe("supplier");
});

test("a 合计 row typed in by hand is still a total, and is reported as unbacked", () => {
  const handTyped: ReadableCell[] = [cell("A10", 10, 1, "合计"), cell("B10", 10, 2, 1_686_000)];

  const totals = extractSheetTotals(handTyped);

  expect(totals).toHaveLength(1);
  expect(totals[0].derived).toBe(false);
  expect(reviewAmountChain({ contracts: [], totals }).handEnteredTotals).toHaveLength(1);
});

test("a header row naming 总价 columns is not itself a totals row", () => {
  // The real 收入测算 parks scratch numbers to the right of its repeated header.
  // Letting the header's own 总价 text declare the row a total made 800000 a
  // customer-side total sitting under 接口名称.
  const totals = extractSheetTotals([
    cell("A34", 34, 1, "接口名称"),
    cell("E34", 34, 5, "不含税总价"),
    cell("N34", 34, 14, 800_000),
    cell("E35", 35, 5, 849_056.6),
    cell("E42", 42, 5, 4_622_641.51, "SUM(E35:E41)"),
  ]);

  expect(totals.map((total) => total.ref)).toEqual(["E42"]);
});

test("a margin rate beside the totals is not read as an amount", () => {
  // 收入测算 row 20 puts F20/J20-1 next to the four SUMs. It is a formula on a
  // totals row, so only its missing money header keeps it out.
  const totals = extractSheetTotals([
    cell("F1", 1, 6, "含税总价"),
    cell("F20", 20, 6, 1_980_000, "SUM(F12:F19)"),
    cell("K20", 20, 11, 0.0615620188121657, "F20/J20-1"),
  ]);

  expect(totals.map((total) => total.ref)).toEqual(["F20"]);
});

test("an ordinary line amount is not mistaken for a total", () => {
  const totals = extractSheetTotals([
    cell("A2", 2, 1, "二要素核验服务"),
    cell("B2", 2, 2, "预估数量"),
    cell("C2", 2, 3, 320_000),
  ]);

  expect(totals).toHaveLength(0);
});

test("the real 天翼五期 revenue total reconciles against the customer side", () => {
  const result = reconcileContractTotal({
    contract: revenueContract,
    totals: extractSheetTotals(REVENUE_MODEL),
  });

  expect(result.status).toBe("MATCHED");
  if (result.status !== "MATCHED") return;
  expect(result.matched.ref).toBe("F20");
});

test("the procurement total reconciles against the supplier side, tax-exclusive", () => {
  const result = reconcileContractTotal({
    contract: procurementContract,
    totals: extractSheetTotals(REVENUE_MODEL),
  });

  expect(result.status).toBe("MATCHED");
  if (result.status !== "MATCHED") return;
  expect(result.matched.ref).toBe("I20");
});

test("a revenue contract is never measured against a supplier total", () => {
  // Without the stance, the project's own margin — 1,980,000 against 1,865,176 —
  // would be reported as a discrepancy.
  const result = reconcileContractTotal({
    contract: revenueContract,
    totals: extractSheetTotals(REVENUE_MODEL),
  });

  if (result.status !== "MATCHED") throw new Error("expected a match");
  expect(result.matched.side).toBe("customer");
});

test("a stale contract total is a mismatch naming the cell and the gap", () => {
  const stale: ContractTotal = { ...revenueContract, amount: 1_890_000 };

  const result = reconcileContractTotal({
    contract: stale,
    totals: extractSheetTotals(REVENUE_MODEL),
  });

  expect(result.status).toBe("MISMATCHED");
  if (result.status !== "MISMATCHED") return;
  expect(result.nearest.ref).toBe("F20");
  expect(result.difference).toBe(-90_000);
});

test("a contract silent on tax basis is compared against every total on its side", () => {
  const silent: ContractTotal = { ...revenueContract, taxIncluded: null, amount: 1_867_924.53 };

  const result = reconcileContractTotal({
    contract: silent,
    totals: extractSheetTotals(REVENUE_MODEL),
  });

  // Narrowing by a basis the contract never stated would leave it unchecked.
  expect(result.status).toBe("MATCHED");
  if (result.status !== "MATCHED") return;
  expect(result.matched.ref).toBe("E20");
});

test("a dossier with no supplier-side total says so instead of reporting a mismatch", () => {
  const customerOnly = extractSheetTotals([
    cell("F1", 1, 6, "客户侧含税总价"),
    cell("F5", 5, 6, 1_980_000, "SUM(F2:F4)"),
  ]);

  const result = reconcileContractTotal({ contract: procurementContract, totals: customerOnly });

  expect(result.status).toBe("NO_CANDIDATE");
  if (result.status !== "NO_CANDIDATE") return;
  expect(result.reason).toContain("供应商侧");
});

test("the review counts what it compared, so the coverage is a stated number", () => {
  const report = reviewAmountChain({
    contracts: [revenueContract, { ...procurementContract, amount: 1_700_000 }],
    totals: extractSheetTotals(REVENUE_MODEL),
  });

  expect(report.checked).toBe(2);
  expect(report.matched).toHaveLength(1);
  expect(report.mismatched).toHaveLength(1);
  expect(report.unchecked).toHaveLength(0);
});
