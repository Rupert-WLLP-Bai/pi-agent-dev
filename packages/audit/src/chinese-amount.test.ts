import { expect, test } from "bun:test";
import { parseChineseAmount } from "./chinese-amount";

test("reads the totals the real dossier contracts state in words", () => {
  // 天翼五期 revenue contract 4.2, against 收入测算 F20 = 1,980,000.
  expect(parseChineseAmount("壹佰玖拾捌万元整")).toBe(1_980_000);
  // The same project's procurement side, 1,865,176 and 1,759,600.
  expect(parseChineseAmount("壹佰捌拾陆万伍仟壹佰柒拾陆元")).toBe(1_865_176);
  expect(parseChineseAmount("壹佰柒拾伍万玖仟陆佰元整")).toBe(1_759_600);
  expect(parseChineseAmount("人民币壹佰万元整")).toBe(1_000_000);
  expect(parseChineseAmount("叁拾万元整")).toBe(300_000);
});

test("accepts the everyday numerals contracts mix in with the financial ones", () => {
  expect(parseChineseAmount("一百九十八万元整")).toBe(1_980_000);
  expect(parseChineseAmount("三十万元")).toBe(300_000);
  expect(parseChineseAmount("两万元")).toBe(20_000);
});

test("an elided 壹 before 拾 reads as ten, as the convention requires", () => {
  expect(parseChineseAmount("拾万元整")).toBe(100_000);
  expect(parseChineseAmount("壹拾万元整")).toBe(100_000);
  expect(parseChineseAmount("拾元")).toBe(10);
});

test("零 holds a place without contributing a digit", () => {
  expect(parseChineseAmount("壹佰零伍万元整")).toBe(1_050_000);
  expect(parseChineseAmount("贰仟零壹拾元")).toBe(2_010);
});

test("角 and 分 read as tenths and hundredths of a yuan", () => {
  expect(parseChineseAmount("壹佰元伍角")).toBe(100.5);
  expect(parseChineseAmount("壹佰元伍角陆分")).toBe(100.56);
  expect(parseChineseAmount("壹元零壹分")).toBe(1.01);
});

test("亿 scales a section above 万", () => {
  expect(parseChineseAmount("壹亿元整")).toBe(100_000_000);
  expect(parseChineseAmount("贰亿叁仟万元整")).toBe(230_000_000);
});

test("a malformed amount is unreadable rather than partly guessed", () => {
  // Reading a total wrong is worse than reporting it unreadable: a wrong number
  // silently passes a reconciliation the parties never agreed to.
  expect(parseChineseAmount("壹贰叁元")).toBeNull();
  expect(parseChineseAmount("万元整")).toBeNull();
  expect(parseChineseAmount("元整")).toBeNull();
  expect(parseChineseAmount("壹佰元伍")).toBeNull();
  expect(parseChineseAmount("")).toBeNull();
  expect(parseChineseAmount("贰佰甲方元")).toBeNull();
});

test("sections must descend, so a repeated or rising 万 is refused", () => {
  expect(parseChineseAmount("壹万贰万元")).toBeNull();
  expect(parseChineseAmount("壹万贰亿元")).toBeNull();
});

test("圆 is accepted as a spelling of 元", () => {
  expect(parseChineseAmount("壹佰万圆整")).toBe(1_000_000);
});
