import type { RuleCode, RuleDisposition } from "./model";

/**
 * Golden set for the deterministic rules bench.
 *
 * Each entry is a contract text plus the ground-truth findings we expect the
 * four deterministic rules (ADVANCE_PAYMENT, PENALTY_RATIO, TERMINATION_CLAUSE,
 * DISPUTE_JURISDICTION) to produce. The bench runner compares rule dispositions
 * against these labels and prints a confusion matrix.
 *
 * Contracts are synthetic but realistic — they follow the clause structure of
 * real procurement contracts while encoding specific risk patterns.
 */
export interface GoldenCase {
  id: string;
  description: string;
  text: string;
  policyLimitRatio: number;
  /**
   * Ground-truth disposition per rule code. Partial: a case labels only the
   * rules it exercises, and an unlabelled rule is simply not run against it.
   */
  expected: Partial<Record<RuleCode, RuleDisposition>>;
}

export const goldenSet: GoldenCase[] = [
  {
    id: "bench-01",
    description: "70% advance payment, no penalty, no termination, no dispute",
    text: `设备采购合同

甲方：深圳精工科技有限公司（采购方）

乙方：重庆华盛贸易有限公司（供货方）

第二条 支付方式
甲方应在合同签订后七日内支付合同总价70%作为预付款。

第三条 交付时间
乙方应于2026年10月31日前完成交付。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "POLICY_CONFLICT",
      PENALTY_RATIO_LIMIT: "NEEDS_HUMAN_REVIEW",
      TERMINATION_CLAUSE_PRESENT: "NEEDS_HUMAN_REVIEW",
      DISPUTE_JURISDICTION: "NEEDS_HUMAN_REVIEW",
    },
  },
  {
    id: "bench-02",
    description: "30% advance, 20% penalty, has termination, Chongqing dispute",
    text: `原材料买卖合同

甲方：深圳精工科技有限公司

乙方：重庆华盛贸易有限公司

第二条 支付方式
甲方支付合同总价30%作为预付款。

第五条 违约责任
乙方逾期交付的，应支付合同总价20%的违约金。

第七条 合同解除
任何一方严重违约，守约方有权解除本合同。

第八条 争议解决
因本合同引起的争议，提交重庆仲裁委员会仲裁。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
      PENALTY_RATIO_LIMIT: "COMPLIANT",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "COMPLIANT",
    },
  },
  {
    id: "bench-03",
    description:
      "50% advance (conflict), 50% penalty (conflict), no termination, Beijing dispute (conflict)",
    text: `电子元件采购合同

甲方：深圳精工科技有限公司

乙方：北京中科电子有限公司

第二条 支付方式
甲方支付合同总价50%作为预付款。

第五条 违约责任
违约方应支付合同总价50%的违约金。

第八条 争议解决
协商不成的，向北京人民法院提起诉讼。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "POLICY_CONFLICT",
      PENALTY_RATIO_LIMIT: "POLICY_CONFLICT",
      TERMINATION_CLAUSE_PRESENT: "NEEDS_HUMAN_REVIEW",
      DISPUTE_JURISDICTION: "POLICY_CONFLICT",
    },
  },
  {
    id: "bench-04",
    description: "30% advance (compliant), no penalty clause, has termination, no dispute",
    text: `工程服务合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第三条 支付方式
甲方支付合同总价30%作为预付款。

第六条 合同终止
本合同在双方履行完毕后终止。任何一方违约，守约方有权提前解除合同。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
      PENALTY_RATIO_LIMIT: "NEEDS_HUMAN_REVIEW",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "NEEDS_HUMAN_REVIEW",
    },
  },
  {
    id: "bench-05",
    description:
      "25% advance (compliant), 10% penalty (compliant), has termination, Shanghai dispute (conflict)",
    text: `备电设备采购合同

甲方：重庆华盛贸易有限公司

乙方：上海电气有限公司

第三条 支付方式
甲方支付合同总价25%作为预付款。

第五条 违约责任
违约方应支付合同总价10%的违约金。

第七条 合同解除
双方协商一致可以解除本合同。

第九条 争议解决
争议提交上海仲裁委员会仲裁。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
      PENALTY_RATIO_LIMIT: "COMPLIANT",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "POLICY_CONFLICT",
    },
  },
  {
    id: "bench-06",
    description:
      "0% advance (compliant), 35% penalty (conflict), has termination, Chongqing dispute (compliant)",
    text: `办公用品采购合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第二条 支付方式
验收合格后一次性支付全款，无预付款。

第五条 违约责任
违约方应支付合同总价35%的违约金。

第七条 合同终止
一方严重违约时，另一方有权单方解除本合同。

第九条 争议解决
争议向重庆人民法院提起诉讼。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
      PENALTY_RATIO_LIMIT: "POLICY_CONFLICT",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "COMPLIANT",
    },
  },
  {
    id: "bench-07",
    description:
      "80% advance (conflict), 5% penalty (compliant), has termination, Chongqing dispute (compliant)",
    text: `大型设备采购合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第二条 支付方式
甲方支付合同总价80%作为预付款。

第五条 违约责任
违约方支付合同总价5%的违约金。

第七条 解除条款
任何一方可提前30日书面通知解除本合同。

第九条 争议解决
提交重庆仲裁委员会仲裁。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "POLICY_CONFLICT",
      PENALTY_RATIO_LIMIT: "COMPLIANT",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "COMPLIANT",
    },
  },
  {
    id: "bench-08",
    description:
      "30% advance (boundary), 30% penalty (boundary), has termination, Chongqing dispute",
    text: `物资采购合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第二条 支付方式
甲方支付合同总价30%作为预付款。

第五条 违约责任
违约方支付合同总价30%的违约金。

第七条 合同解除
双方约定可协商解除合同。

第九条 争议解决
向重庆人民法院起诉。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
      PENALTY_RATIO_LIMIT: "COMPLIANT",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "COMPLIANT",
    },
  },
  {
    id: "bench-09",
    description:
      "31% advance (barely over), 29% penalty (barely under), no termination, no dispute",
    text: `零部件采购合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第二条 支付方式
甲方支付合同总价31%作为预付款。

第五条 违约责任
违约方支付合同总价29%的违约金。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "POLICY_CONFLICT",
      PENALTY_RATIO_LIMIT: "COMPLIANT",
      TERMINATION_CLAUSE_PRESENT: "NEEDS_HUMAN_REVIEW",
      DISPUTE_JURISDICTION: "NEEDS_HUMAN_REVIEW",
    },
  },
  {
    id: "bench-10",
    description: "No advance payment at all, no penalty, has termination, no dispute",
    text: `服务外包合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第二条 合同期限
本合同自签订之日起生效，有效期为一年。

第六条 合同终止
合同期满自动终止。任何一方违约，守约方有权解除合同。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
      PENALTY_RATIO_LIMIT: "NEEDS_HUMAN_REVIEW",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "NEEDS_HUMAN_REVIEW",
    },
  },
  {
    id: "bench-11",
    description: "15% advance, 15% penalty, has termination, Chongqing arbitration (compliant)",
    text: `医疗器械采购合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第三条 支付方式
甲方支付合同总价15%作为预付款。

第五条 违约责任
违约方支付合同总价15%的违约金。

第七条 合同解除
一方严重违约，另一方有权解除本合同。

第九条 争议解决
因本合同争议提交重庆仲裁委员会仲裁。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
      PENALTY_RATIO_LIMIT: "COMPLIANT",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "COMPLIANT",
    },
  },
  {
    id: "bench-12",
    description:
      "60% advance (conflict), 40% penalty (conflict), no termination, Beijing dispute (conflict) — all 4 rules fire",
    text: `建材采购合同

甲方：重庆华盛贸易有限公司

乙方：北京建材有限公司

第二条 支付方式
甲方支付合同总价60%作为预付款。

第五条 违约责任
违约方支付合同总价40%的违约金。

第八条 争议解决
向北京人民法院提起诉讼。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "POLICY_CONFLICT",
      PENALTY_RATIO_LIMIT: "POLICY_CONFLICT",
      TERMINATION_CLAUSE_PRESENT: "NEEDS_HUMAN_REVIEW",
      DISPUTE_JURISDICTION: "POLICY_CONFLICT",
    },
  },

  // ── Wave 2 catalogue · PERFORMANCE_BOND_RATIO_LIMIT (10%) ──────────────
  {
    id: "bench-13",
    description: "performance bond 15% — over the 10% statutory ceiling",
    text: `设备采购合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第二条 合同价款
合同总价为人民币壹佰伍拾万元整（小写：1,500,000.00元）。

第三条 履约保证金
乙方应在合同签订后十日内提交履约保证金，金额为中标合同金额的15%。`,
    policyLimitRatio: 0.3,
    expected: { PERFORMANCE_BOND_RATIO_LIMIT: "POLICY_CONFLICT" },
  },
  {
    id: "bench-14",
    description: "performance bond exactly 10% — at the ceiling, not over",
    text: `设备采购合同

第二条 合同价款
合同总价为人民币壹佰伍拾万元整。

第三条 履约保证金
乙方应提交履约保证金，金额为中标合同金额的10%。`,
    policyLimitRatio: 0.3,
    expected: { PERFORMANCE_BOND_RATIO_LIMIT: "COMPLIANT" },
  },
  {
    id: "bench-15",
    description: "performance bond 100万 against 950万 contract (10.53%) — amount form over limit",
    text: `设备采购合同

第二条 合同价款
合同总价为人民币玖佰伍拾万元整（小写：9,500,000.00元）。

第三条 履约保证金
乙方应在合同签订后十日内提交履约保证金人民币壹佰万元整。`,
    policyLimitRatio: 0.3,
    expected: { PERFORMANCE_BOND_RATIO_LIMIT: "POLICY_CONFLICT" },
  },
  {
    id: "bench-16",
    description: "performance bond amount with no contract total — denominator missing",
    text: `设备采购合同

第三条 履约保证金
乙方应在合同签订后十日内提交履约保证金人民币壹佰万元整。`,
    policyLimitRatio: 0.3,
    expected: { PERFORMANCE_BOND_RATIO_LIMIT: "NEEDS_HUMAN_REVIEW" },
  },

  // ── Wave 2 catalogue · PAYMENT_TERM_LIMIT (60 days) ────────────────────
  {
    id: "bench-17",
    description: "90-day payment term — over the 60-day ceiling",
    text: `服务合同

第三条 支付方式
甲方应于乙方交付并验收合格后90日内支付合同全部价款。`,
    policyLimitRatio: 0.3,
    expected: { PAYMENT_TERM_LIMIT: "POLICY_CONFLICT" },
  },
  {
    id: "bench-18",
    description: "60-day payment term — at the ceiling, not over",
    text: `服务合同

第三条 支付方式
甲方应于乙方交付之日起60日内支付合同价款。`,
    policyLimitRatio: 0.3,
    expected: { PAYMENT_TERM_LIMIT: "COMPLIANT" },
  },
  {
    id: "bench-19",
    description: "payment obligation with no fixed term — route to a human",
    text: `服务合同

第三条 支付方式
验收合格后一次性支付全款，无预付款。`,
    policyLimitRatio: 0.3,
    expected: { PAYMENT_TERM_LIMIT: "NEEDS_HUMAN_REVIEW" },
  },
  {
    id: "bench-20",
    description: "60 working days (≈84 natural days) — workday unit converted",
    text: `服务合同

第三条 支付方式
甲方应于乙方交付之日起60个工作日内支付合同价款。`,
    policyLimitRatio: 0.3,
    expected: { PAYMENT_TERM_LIMIT: "POLICY_CONFLICT" },
  },

  // ── Wave 2 catalogue · BACK_TO_BACK_PAYMENT_CLAUSE ─────────────────────
  {
    id: "bench-21",
    description: "payment after receiving the owner's money — back-to-back",
    text: `分包合同

第五条 付款方式
甲方在收到业主方支付的相应工程款后15日内向乙方支付本合同款项。`,
    policyLimitRatio: 0.3,
    expected: { BACK_TO_BACK_PAYMENT_CLAUSE: "POLICY_CONFLICT" },
  },
  {
    id: "bench-22",
    description: "explicitly not conditioned on a third party — clean",
    text: `分包合同

第五条 付款方式
甲方应于验收合格后30日内向乙方支付合同价款，不以任何第三方付款为前提。`,
    policyLimitRatio: 0.3,
    expected: { BACK_TO_BACK_PAYMENT_CLAUSE: "COMPLIANT" },
  },
  {
    id: "bench-23",
    description: "same-proportion settlement mirror — disguised back-to-back",
    text: `分包合同

第五条 付款方式
双方按与业主的结算进度同比例支付工程款。`,
    policyLimitRatio: 0.3,
    expected: { BACK_TO_BACK_PAYMENT_CLAUSE: "POLICY_CONFLICT" },
  },

  // ── Wave 2 catalogue · DEPOSIT_RATIO_LIMIT (20%) ───────────────────────
  {
    id: "bench-24",
    description: "deposit 25% of contract value — over the 20% ceiling",
    text: `采购合同

第二条 合同价款
合同总价为人民币壹佰万元整。

第三条 定金
乙方应支付定金为合同总价的25%。`,
    policyLimitRatio: 0.3,
    expected: { DEPOSIT_RATIO_LIMIT: "POLICY_CONFLICT" },
  },
  {
    id: "bench-25",
    description: "deposit exactly 20% — at the ceiling, not over",
    text: `采购合同

第三条 定金
乙方应支付定金为合同总价的20%。`,
    policyLimitRatio: 0.3,
    expected: { DEPOSIT_RATIO_LIMIT: "COMPLIANT" },
  },
  {
    id: "bench-26",
    description: "订金 30% — a different money, Article 586 does not apply",
    text: `采购合同

第三条 订金
乙方应支付订金为合同总价的30%。`,
    policyLimitRatio: 0.3,
    expected: { DEPOSIT_RATIO_LIMIT: "COMPLIANT" },
  },
  {
    id: "bench-27",
    description: "deposit 30万 against 100万 contract — amount form over limit",
    text: `采购合同

第二条 合同价款
合同总价为人民币壹佰万元整。

第三条 定金
乙方应支付定金人民币叁拾万元整。`,
    policyLimitRatio: 0.3,
    expected: { DEPOSIT_RATIO_LIMIT: "POLICY_CONFLICT" },
  },
  {
    id: "bench-28",
    description: "deposit amount with no contract total — denominator missing",
    text: `采购合同

第三条 定金
乙方应支付定金人民币叁拾万元整。`,
    policyLimitRatio: 0.3,
    expected: { DEPOSIT_RATIO_LIMIT: "NEEDS_HUMAN_REVIEW" },
  },

  // ── Wave 2 catalogue · WARRANTY_RETENTION_RATIO_LIMIT (3%, 24 months) ──
  {
    id: "bench-29",
    description: "quality retention 5% — over the 3% ceiling",
    text: `工程合同

第二条 合同价款
工程价款结算总额为人民币壹佰万元整。

第三条 质量保证金
竣工验收合格后，甲方预留工程价款结算总额5%作为质量保证金。`,
    policyLimitRatio: 0.3,
    expected: { WARRANTY_RETENTION_RATIO_LIMIT: "POLICY_CONFLICT" },
  },
  {
    id: "bench-30",
    description: "retention 3% with a 1-year defect period — both within limits",
    text: `工程合同

第三条 质量保证金
甲方预留工程价款结算总额的3%作为质量保证金，缺陷责任期1年。`,
    policyLimitRatio: 0.3,
    expected: { WARRANTY_RETENTION_RATIO_LIMIT: "COMPLIANT" },
  },
  {
    id: "bench-31",
    description: "defect liability period 30 months — over the 24-month ceiling",
    text: `工程合同

第三条 缺陷责任期
本工程缺陷责任期为30个月。`,
    policyLimitRatio: 0.3,
    expected: { WARRANTY_RETENTION_RATIO_LIMIT: "POLICY_CONFLICT" },
  },

  // ── Wave 2 catalogue · DISPUTE_RESOLUTION_CONFLICT ─────────────────────
  {
    id: "bench-32",
    description: "arbitration or litigation — or-arbitration-or-litigation clause",
    text: `第九条 争议解决
双方可向重庆仲裁委员会申请仲裁，也可以向甲方所在地人民法院提起诉讼。`,
    policyLimitRatio: 0.3,
    expected: { DISPUTE_RESOLUTION_CONFLICT: "POLICY_CONFLICT" },
  },
  {
    id: "bench-33",
    description: "pure arbitration with a final award — clean",
    text: `第九条 争议解决
因本合同争议提交重庆仲裁委员会仲裁，仲裁裁决为终局裁决。`,
    policyLimitRatio: 0.3,
    expected: { DISPUTE_RESOLUTION_CONFLICT: "COMPLIANT" },
  },
  {
    id: "bench-34",
    description: "litigation only after arbitration fails — valid fallback",
    text: `第九条 争议解决
因本合同争议，仲裁不成的，可向人民法院起诉。`,
    policyLimitRatio: 0.3,
    expected: { DISPUTE_RESOLUTION_CONFLICT: "COMPLIANT" },
  },

  // ── Wave 2 catalogue · BID_BOND_RATIO_LIMIT (2%) ───────────────────────
  {
    id: "bench-35",
    description: "bid bond 5万 against 200万 estimate (2.5%) — over limit",
    text: `投标须知

投标人须在投标截止前缴纳投标保证金人民币伍万元整（本项目估算价贰佰万元整）。`,
    policyLimitRatio: 0.3,
    expected: { BID_BOND_RATIO_LIMIT: "POLICY_CONFLICT" },
  },
  {
    id: "bench-36",
    description: "bid bond exactly 2% — at the ceiling, not over",
    text: `投标须知

投标保证金为招标项目估算价的2%。`,
    policyLimitRatio: 0.3,
    expected: { BID_BOND_RATIO_LIMIT: "COMPLIANT" },
  },

  // ── Wave 2 catalogue · IP_OWNERSHIP_MISSING ────────────────────────────
  {
    id: "bench-37",
    description: "custom development with no IP clause — ownership left to law",
    text: `软件定制开发服务合同

第二条 服务内容
乙方为甲方定制开发业务管理系统，并交付源代码与相关文档。`,
    policyLimitRatio: 0.3,
    expected: { IP_OWNERSHIP_MISSING: "POLICY_CONFLICT" },
  },
  {
    id: "bench-38",
    description: "custom development with an explicit IP assignment — clean",
    text: `软件定制开发服务合同

第二条 服务内容
乙方为甲方定制开发业务管理系统。

第四条 知识产权
本项目产生的软件著作权及专利申请权均归甲方所有。`,
    policyLimitRatio: 0.3,
    expected: { IP_OWNERSHIP_MISSING: "COMPLIANT" },
  },

  // ── Wave 2 catalogue · GUARANTEE_MODE_AMBIGUOUS ────────────────────────
  {
    id: "bench-39",
    description: "suretyship with no mode named — presumed ordinary guarantee",
    text: `第四条 保证条款
丙方为乙方在本合同项下的全部义务提供保证。`,
    policyLimitRatio: 0.3,
    expected: { GUARANTEE_MODE_AMBIGUOUS: "POLICY_CONFLICT" },
  },
  {
    id: "bench-40",
    description: "joint and several guarantee — mode clear",
    text: `第四条 保证条款
丙方为乙方在本合同项下的全部义务提供连带责任保证。`,
    policyLimitRatio: 0.3,
    expected: { GUARANTEE_MODE_AMBIGUOUS: "COMPLIANT" },
  },

  // ── Wave 2 catalogue · CONFIDENTIALITY_PERIOD_MISSING ──────────────────
  {
    id: "bench-41",
    description: "confidentiality clause with no term — effectively open-ended",
    text: `第八条 保密
双方对本合同内容及履行过程中知悉的信息负有保密义务。`,
    policyLimitRatio: 0.3,
    expected: { CONFIDENTIALITY_PERIOD_MISSING: "POLICY_CONFLICT" },
  },
  {
    id: "bench-42",
    description: "confidentiality term of 5 years — within the reference ceiling",
    text: `第八条 保密
保密义务自本合同签订之日起5年内有效。`,
    policyLimitRatio: 0.3,
    expected: { CONFIDENTIALITY_PERIOD_MISSING: "COMPLIANT" },
  },
  {
    id: "bench-43",
    description: "confidentiality until the information becomes public — acceptable term",
    text: `第八条 保密
保密期限至相关信息公开之日止。`,
    policyLimitRatio: 0.3,
    expected: { CONFIDENTIALITY_PERIOD_MISSING: "COMPLIANT" },
  },

  // ── Wave 2 catalogue · FORCE_MAJEURE_OVERBROAD ─────────────────────────
  {
    id: "bench-44",
    description: "force majeure sweeping in market and policy risk — overbroad",
    text: `第十二条 不可抗力
不可抗力包括但不限于自然灾害、战争、政府政策调整、市场价格波动、第三方原因等情形，遭遇不可抗力一方无需承担任何责任。`,
    policyLimitRatio: 0.3,
    expected: { FORCE_MAJEURE_OVERBROAD: "POLICY_CONFLICT" },
  },
  {
    id: "bench-45",
    description: "force majeure per the statutory definition with notice duty — clean",
    text: `第十二条 不可抗力
不可抗力是指不能预见、不能避免且不能克服的客观情况。遭遇不可抗力的一方应及时通知对方并在合理期限内提供证明。`,
    policyLimitRatio: 0.3,
    expected: { FORCE_MAJEURE_OVERBROAD: "COMPLIANT" },
  },

  // ── Wave 2 catalogue · LIABILITY_CAP_MISSING ───────────────────────────
  {
    id: "bench-46",
    description: "one-sided cap with no ceiling on the other party — asymmetric",
    text: `第六条 赔偿责任
乙方对甲方的任何赔偿责任累计不超过人民币壹佰万元；但甲方对乙方不设赔偿上限。`,
    policyLimitRatio: 0.3,
    expected: { LIABILITY_CAP_MISSING: "POLICY_CONFLICT" },
  },
  {
    id: "bench-47",
    description: "symmetric cap with statutory carve-out — clean",
    text: `第六条 赔偿责任
任何一方的累计赔偿责任不超过合同总价的100%；人身损害及故意、重大过失不受此限。`,
    policyLimitRatio: 0.3,
    expected: { LIABILITY_CAP_MISSING: "COMPLIANT" },
  },
  {
    id: "bench-48",
    description: "high-value contract with no liability cap — review, not a false conflict",
    text: `第二条 合同价款
合同总价为人民币陆佰万元整（小写：6,000,000.00元）。`,
    policyLimitRatio: 0.3,
    expected: { LIABILITY_CAP_MISSING: "NEEDS_HUMAN_REVIEW" },
  },
  {
    // Boundary for DISPUTE_JURISDICTION: the named jurisdiction is a district
    // inside our own city, so the rule's region-containment check ("重庆市南岸区"
    // contains "重庆") must keep it compliant rather than flag a same-city clause.
    id: "bench-49",
    description: "boundary · dispute names a district inside our city (重庆市南岸区)",
    text: `设备安装工程合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第二条 支付方式
甲方支付合同总价20%作为预付款。

第五条 违约责任
违约方支付合同总价10%的违约金。

第七条 合同解除
任何一方严重违约，守约方有权解除本合同。

第九条 争议解决
协商不成的，向重庆市南岸区人民法院提起诉讼。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
      PENALTY_RATIO_LIMIT: "COMPLIANT",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "COMPLIANT",
    },
  },
  {
    // Boundary for TERMINATION_CLAUSE_PRESENT: the clause is named only by its
    // heading (第八条 合同终止) and the body states completion rather than an
    // affirmative act on the contract — the heading signal alone must satisfy it.
    id: "bench-50",
    description: "boundary · termination named only by a heading (wording variant)",
    text: `技术咨询服务合同

甲方：重庆华盛贸易有限公司

乙方：深圳精工科技有限公司

第三条 支付方式
甲方支付合同总价10%作为预付款。

第六条 违约责任
违约方支付合同总价5%的违约金。

第八条 合同终止
双方履行完毕或协商一致时，本合同权利义务终止。`,
    policyLimitRatio: 0.3,
    expected: {
      ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
      PENALTY_RATIO_LIMIT: "COMPLIANT",
      TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
      DISPUTE_JURISDICTION: "NEEDS_HUMAN_REVIEW",
    },
  },
];
