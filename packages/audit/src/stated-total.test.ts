import { expect, test } from "bun:test";
import { normalizeContractDocument } from "./plaintext-adapter";
import { readStatedTotals } from "./stated-total";

test("the prose form is read with the tax basis the clause states", () => {
  const document = normalizeContractDocument(
    "项目周期内，本协议最大发生金额为（含税价）人民币大写【壹佰玖拾捌万】元整，小写【1980000】元。",
  );

  const totals = readStatedTotals(document);

  expect(totals).toHaveLength(1);
  expect(totals[0].amount).toBe(1_980_000);
  expect(totals[0].taxIncluded).toBe(true);
  expect(totals[0].blockId).toBe(document.blocks[0].blockId);
});

test("a price table's two bases are both read, identified by the stated rate", () => {
  // The real 元通 第四条 table, flattened as the parser hands it over. The
  // numbers carry no 元 — the unit is in the header — so nothing but the
  // arithmetic identifies them.
  const document = normalizeContractDocument(
    "项目名称 服务内容 不含税价格（元） 税率 含税价格（元） 客户管理大数据服务项目（五期） 数据服务能力。 1759600 6% 1865176",
  );

  const totals = readStatedTotals(document);

  expect(totals).toHaveLength(2);
  expect(totals.find((total) => total.taxIncluded === false)?.amount).toBe(1_759_600);
  expect(totals.find((total) => total.taxIncluded === true)?.amount).toBe(1_865_176);
});

test("the basis sentence names the arithmetic the reading rests on", () => {
  const document = normalizeContractDocument(
    "不含税价格（元） 税率 含税价格（元） 1759600 6% 1865176",
  );

  const [exclusive] = readStatedTotals(document);

  expect(exclusive.basis).toContain("6%");
  expect(exclusive.basis).toContain("1865176");
});

test("a line-item table is not read as a project total", () => {
  // Every line satisfies the same tax relation, so no single pair identifies the
  // project price. Picking one would report a service line as the contract total.
  const document = normalizeContractDocument(
    "服务内容 预估数量 不含税单价 不含税金额（元） 税率 含税单价 含税金额（元）" +
      " 二要素核验 2000000 0.16 320000 6% 0.1696 339200" +
      " 三要素核验 2000000 0.169 338000 0.17914 358280",
  );

  expect(readStatedTotals(document)).toHaveLength(0);
});

test("a penalty clause's percentage is not a tax rate", () => {
  // 违约金百分之二十 normalises to 20%, and a rate that high pairs nothing.
  const document = normalizeContractDocument(
    "乙方应当向甲方支付相当于合同总价款百分之【20】的违约金。不含税价格 100000 与 120000。",
  );

  expect(readStatedTotals(document)).toHaveLength(0);
});

test("a unit price pair is not promoted to a contract total", () => {
  const document = normalizeContractDocument("不含税单价 0.16 税率 6% 含税单价 0.1696");

  expect(readStatedTotals(document)).toHaveLength(0);
});

test("a table stating only one basis yields nothing rather than a guess", () => {
  const document = normalizeContractDocument("不含税价格（元） 1759600");

  expect(readStatedTotals(document)).toHaveLength(0);
});

test("the same amount stated twice on the same basis is reported once", () => {
  const document = normalizeContractDocument(
    "合同总价为人民币大写壹佰玖拾捌万元整（含税），小写1980000元。" +
      "不含税价格（元） 税率 含税价格（元） 1867924.53 6% 1980000",
  );

  const inclusive = readStatedTotals(document).filter((total) => total.taxIncluded === true);

  expect(inclusive.map((total) => total.amount)).toEqual([1_980_000]);
});

test("a tax-inclusive figure rounded to the yuan still pairs with its base", () => {
  // 853236.595 × 1.06 = 904430.7907, which a contract writes as 904431.
  const document = normalizeContractDocument(
    "不含税价格（元） 税率 含税价格（元） 853236.6 6% 904430.8",
  );

  const totals = readStatedTotals(document);

  expect(totals.map((total) => total.amount)).toEqual([853_236.6, 904_430.8]);
});
