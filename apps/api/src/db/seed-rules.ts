import type { RuleRepository, SeedRule } from "./rule-repository";

/**
 * Bootstrap catalog for the rules the deterministic engine already implements.
 *
 * These are not new rules — the TypeScript evaluators are unchanged. The seed
 * records each rule's current hardcoded defaults as a published v1, so the
 * governance UI starts from the parameters the engine actually runs under and
 * every later change goes through a version + validation.
 */

export const SEED_PUBLISHER = "系统初始化";

export const SEED_RULE_DEFINITIONS: readonly SeedRule[] = [
  {
    code: "ADVANCE_PAYMENT_LIMIT",
    name: "预付款上限规则",
    contractType: "采购类",
    description: "预付款比例不得超过制度上限；超出即触发 POLICY_CONFLICT。",
    params: { limitRatio: 0.3 },
    stances: {
      preferred: "首选 ≤30%",
      acceptableRetreat: "可退让 ≤40% 需审批",
      unacceptable: "不可接受 >40%",
      exceptionApproval: "高级管理层书面审批",
    },
  },
  {
    code: "PENALTY_RATIO_LIMIT",
    name: "违约金比例规则",
    contractType: "全部",
    description: "违约金比例不得超过制度上限；未约定违约金条款转人工复核。",
    params: { limitRatio: 0.3 },
    stances: {
      preferred: "首选 ≤30%",
      acceptableRetreat: "可退让 ≤40% 需审批",
      unacceptable: "不可接受 >40%",
      exceptionApproval: "高级管理层书面审批",
    },
  },
  {
    code: "TERMINATION_CLAUSE_PRESENT",
    name: "合同解除条款规则",
    contractType: "全部",
    description: "合同应包含明确的解除或终止条款；缺失时转人工复核。",
    params: {},
    stances: {
      preferred: "首选 明确约定守约方的单方解除权",
      acceptableRetreat: "可退让 约定双方协商解除",
      unacceptable: "不可接受 未约定解除或终止条款",
      exceptionApproval: "法务书面确认",
    },
  },
  {
    code: "DISPUTE_JURISDICTION",
    name: "争议管辖规则",
    contractType: "全部",
    description: "争议管辖地应与我方所在地一致；不一致即触发 POLICY_CONFLICT。",
    params: { preferredJurisdiction: "重庆" },
    stances: {
      preferred: "首选 重庆仲裁委员会或重庆人民法院",
      acceptableRetreat: "可退让 第三方中立地，需评估维权成本",
      unacceptable: "不可接受 与己方无关的异地管辖",
      exceptionApproval: "法务书面审批",
    },
  },
  {
    code: "SUBJECT_RED_LINE_RISK",
    name: "主体红线风险规则",
    contractType: "全部",
    description: "交易对手存在失信、被执行等红线风险时触发风险发现。",
    params: {},
    stances: {
      preferred: "首选 交易对手无红线风险",
      acceptableRetreat: "可退让 存在背景性风险，需持续关注",
      unacceptable: "不可接受 存在失信、被执行等红线风险",
      exceptionApproval: "高级管理层书面审批",
    },
  },
];

/**
 * Seeds the catalog once. A database that already holds any rule is left
 * untouched — an operator's published versions are never overwritten by a
 * restart.
 */
export async function seedRules(repository: RuleRepository): Promise<number> {
  if ((await repository.countRules()) > 0) return 0;
  return repository.bootstrapRules(SEED_RULE_DEFINITIONS, SEED_PUBLISHER);
}
