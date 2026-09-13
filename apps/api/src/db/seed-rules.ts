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

  // ── Wave 2 catalogue expansion ─────────────────────────────────────────
  {
    code: "PERFORMANCE_BOND_RATIO_LIMIT",
    name: "履约保证金比例规则",
    contractType: "采购类",
    description:
      "履约保证金不得超过合同金额的 10%（《招标投标法实施条例》第五十八条、《政府采购法实施条例》第四十八条）。",
    params: { maxRatio: 0.1 },
    stances: {
      preferred: "首选 ≤10%",
      acceptableRetreat: "可退让 以银行保函替代且金额 ≤10%",
      unacceptable: "不可接受 >10%",
      exceptionApproval: "高级管理层书面审批",
    },
  },
  {
    code: "PAYMENT_TERM_LIMIT",
    name: "付款期限规则",
    contractType: "全部",
    description:
      "付款期限最长不得超过 60 日（《保障中小企业款项支付条例》第九条）；未约定期限转人工复核。",
    params: { maxDays: 60 },
    stances: {
      preferred: "首选 ≤30 日",
      acceptableRetreat: "可退让 ≤60 日",
      unacceptable: "不可接受 >60 日或未约定付款期限",
      exceptionApproval: "法务书面审批",
    },
  },
  {
    code: "BACK_TO_BACK_PAYMENT_CLAUSE",
    name: "背靠背付款条款规则",
    contractType: "工程类",
    description: "以收到第三方（业主/发包人）付款为付款前提的背靠背条款无效（法释〔2024〕11 号）。",
    params: {},
    stances: {
      preferred: "首选 无条件付款",
      acceptableRetreat: "可退让 约定非第三方付款的明确触发事件",
      unacceptable: "不可接受 以收到第三方付款作为付款前提",
      exceptionApproval: "法务书面审批",
    },
  },
  {
    code: "DEPOSIT_RATIO_LIMIT",
    name: "定金比例规则",
    contractType: "采购类",
    description: "定金不得超过主合同标的额的 20%（《民法典》第五百八十六条）；订金、押金不适用。",
    params: { maxRatio: 0.2 },
    stances: {
      preferred: "首选 ≤20%",
      acceptableRetreat: "可退让 改为订金或预付款并明确抵扣",
      unacceptable: "不可接受 >20%",
      exceptionApproval: "高级管理层书面审批",
    },
  },
  {
    code: "WARRANTY_RETENTION_RATIO_LIMIT",
    name: "质量保证金比例规则",
    contractType: "工程类",
    description:
      "质量保证金预留比例不得高于工程价款结算总额的 3%，缺陷责任期最长 24 个月（建质〔2017〕138 号第七条）。",
    params: { maxRatio: 0.03, defectLiabilityPeriodMaxMonths: 24 },
    stances: {
      preferred: "首选 ≤3% 且缺陷责任期 ≤24 个月",
      acceptableRetreat: "可退让 以银行保函替代且金额 ≤3%",
      unacceptable: "不可接受 >3% 或缺陷责任期 >24 个月",
      exceptionApproval: "高级管理层书面审批",
    },
  },
  {
    code: "DISPUTE_RESOLUTION_CONFLICT",
    name: "或裁或诉规则",
    contractType: "全部",
    description:
      "约定争议可申请仲裁也可向法院起诉的，仲裁协议无效（《仲裁法司法解释》第七条）；仲裁不成可诉为有效后置表述。",
    params: {},
    stances: {
      preferred: "首选 单一仲裁或单一诉讼",
      acceptableRetreat: "可退让 约定仲裁不成后可诉",
      unacceptable: "不可接受 或裁或诉并列",
      exceptionApproval: "法务书面审批",
    },
  },
  {
    code: "BID_BOND_RATIO_LIMIT",
    name: "投标保证金比例规则",
    contractType: "采购类",
    description:
      "投标保证金不得超过招标项目估算价（采购项目预算金额）的 2%（《招标投标法实施条例》第二十六条、《政府采购法实施条例》第三十三条）。",
    params: { maxRatio: 0.02 },
    stances: {
      preferred: "首选 ≤2%",
      acceptableRetreat: "可退让 以银行保函替代且 ≤2%",
      unacceptable: "不可接受 >2%",
      exceptionApproval: "高级管理层书面审批",
    },
  },
  {
    code: "IP_OWNERSHIP_MISSING",
    name: "知识产权归属规则",
    contractType: "服务类",
    description:
      "开发/定制类合同应明确知识产权归属；未约定时依法定归属可能不利于采购人（《民法典》第八百五十九条、第八百六十条）。",
    params: {},
    stances: {
      preferred: "首选 明确约定归采购人所有",
      acceptableRetreat: "可退让 约定共有或采购人免费实施",
      unacceptable: "不可接受 未约定知识产权归属",
      exceptionApproval: "法务书面审批",
    },
  },
  {
    code: "GUARANTEE_MODE_AMBIGUOUS",
    name: "保证方式规则",
    contractType: "全部",
    description:
      "保证担保应明确保证方式；未约定或约定不明的依法按一般保证承担责任（《民法典》第六百八十六条）。",
    params: {},
    stances: {
      preferred: "首选 明确约定连带责任保证",
      acceptableRetreat: "可退让 明确一般保证并评估先诉抗辩风险",
      unacceptable: "不可接受 未约定保证方式",
      exceptionApproval: "法务书面审批",
    },
  },
  {
    code: "CONFIDENTIALITY_PERIOD_MISSING",
    name: "保密期限规则",
    contractType: "全部",
    description:
      "保密条款应约定保密期限；未约定期限则义务持续至信息丧失秘密性为止（《民法典》第五百零一条、第五百五十八条）。",
    params: { expectedMaxYears: 5 },
    stances: {
      preferred: "首选 明确约定 ≤5 年",
      acceptableRetreat: "可退让 约定至相关信息公开之日止",
      unacceptable: "不可接受 未约定期限或约定长期/永久有效",
      exceptionApproval: "法务书面审批",
    },
  },
  {
    code: "FORCE_MAJEURE_OVERBROAD",
    name: "不可抗力范围规则",
    contractType: "全部",
    description:
      "不可抗力应符合不能预见、不能避免、不能克服三项要件，并约定通知与证明义务（《民法典》第一百八十条、第五百九十条）。",
    params: {},
    stances: {
      preferred: "首选 按法定三要件定义并约定通知/证明义务",
      acceptableRetreat: "可退让 列明具体不可抗力事件类型",
      unacceptable: "不可接受 将市场价格波动、政策调整等商业风险纳入免责",
      exceptionApproval: "法务书面审批",
    },
  },
  {
    code: "LIABILITY_CAP_MISSING",
    name: "赔偿责任上限规则",
    contractType: "全部",
    description:
      "高价值合同宜约定对等的赔偿责任限额；单方不设上限或完全无上限存在赔偿范围不确定风险（《民法典》第五百零六条、第五百八十四条）。",
    params: { highValueThreshold: 5_000_000 },
    stances: {
      preferred: "首选 对等责任限额并排除法定无效情形",
      acceptableRetreat: "可退让 高价值合同设置合理赔偿上限",
      unacceptable: "不可接受 单方不设上限或完全无上限",
      exceptionApproval: "高级管理层书面审批",
    },
  },
];

/**
 * Reconciles the catalog with the code. Rules the database already holds are
 * left untouched — an operator's published versions are never overwritten —
 * while a rule added in a later release is inserted on the next start, so the
 * catalogue can grow without a reset.
 */
export async function seedRules(repository: RuleRepository): Promise<number> {
  return repository.bootstrapRules(SEED_RULE_DEFINITIONS, SEED_PUBLISHER);
}
