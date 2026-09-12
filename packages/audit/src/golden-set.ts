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
  /** Ground-truth disposition per rule code. */
  expected: {
    ADVANCE_PAYMENT_LIMIT: "POLICY_CONFLICT" | "COMPLIANT";
    PENALTY_RATIO_LIMIT: "POLICY_CONFLICT" | "COMPLIANT" | "NEEDS_HUMAN_REVIEW";
    TERMINATION_CLAUSE_PRESENT: "COMPLIANT" | "NEEDS_HUMAN_REVIEW";
    DISPUTE_JURISDICTION: "POLICY_CONFLICT" | "COMPLIANT" | "NEEDS_HUMAN_REVIEW";
  };
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
];
