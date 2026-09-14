import type { ContractParty, RuleCode } from "./model";

/**
 * Which side of the money our organization is on in a given contract.
 *
 * An ICT project signs both: a revenue contract where we supply a customer, and
 * a procurement contract where we buy from a supplier to deliver it. The same
 * clause reads as a risk in one and as an advantage in the other, so a rule that
 * does not know the stance will judge half the dossier backwards.
 */
export type ContractStance = "revenue" | "procurement";

/** The stance plus what it was read off, so a reviewer can disagree with it. */
export interface StanceInference {
  /** Null when the contract gives no usable signal; no rule is filtered then. */
  stance: ContractStance | null;
  basis: string;
  /** The party whose label decided it, or null when nothing decided it. */
  decidedByPartyId: string | null;
}

/**
 * The party labels that mean "the buyer" and "the supplier" in a Chinese
 * contract. 甲方 is conventionally the party that procures and pays; 乙方 the
 * party that supplies and is paid.
 */
const BUYER_LABELS = ["甲方", "需方", "发包方", "采购方", "委托方"];
const SUPPLIER_LABELS = ["乙方", "供方", "承包方", "供应商", "受托方", "服务方"];

const matchesLabel = (label: string, candidates: string[]): boolean =>
  candidates.some((candidate) => label.includes(candidate));

/**
 * Reads our own stance off the party list.
 *
 * The signal is structural rather than lexical: find the party that *is* our
 * organization, then read the role its label assigns. Where we sit as 乙方 we
 * are being paid, so the contract earns revenue; as 甲方 we are paying, so it
 * spends. Filename markers like 【收入合同】 are a stronger signal when present,
 * but they live outside the document — a caller that has one passes it as
 * `declared` instead of calling this.
 */
export function inferContractStance(input: {
  parties: ContractParty[];
  /**
   * Name fragments identifying our own organization, e.g. ["重庆移动", "中国移动"].
   * Matching is by substring because contracts write the same entity many ways.
   */
  ownOrganizationNames: readonly string[];
}): StanceInference {
  const fragments = input.ownOrganizationNames.filter((name) => name.trim().length > 0);
  if (fragments.length === 0) {
    return { stance: null, basis: "未配置本方主体名称，无法判断合同立场", decidedByPartyId: null };
  }

  const ours = input.parties.filter((party) =>
    fragments.some((fragment) => party.name.includes(fragment)),
  );
  if (ours.length === 0) {
    return {
      stance: null,
      basis: `合同当事人中未出现本方主体（${fragments.join("、")}），无法判断合同立场`,
      decidedByPartyId: null,
    };
  }
  // Our organization on both sides is an internal contract, not a stance we can
  // reduce to one direction. Guessing here would silence rules on purpose.
  if (ours.length > 1) {
    return {
      stance: null,
      basis: `本方主体同时出现在 ${ours.map((party) => party.label).join("、")}，立场不唯一`,
      decidedByPartyId: null,
    };
  }

  const party = ours[0];
  if (matchesLabel(party.label, SUPPLIER_LABELS)) {
    return {
      stance: "revenue",
      basis: `本方为${party.label}（${party.name}），是收款方，立场为收入`,
      decidedByPartyId: party.id,
    };
  }
  if (matchesLabel(party.label, BUYER_LABELS)) {
    return {
      stance: "procurement",
      basis: `本方为${party.label}（${party.name}），是付款方，立场为采购`,
      decidedByPartyId: party.id,
    };
  }
  return {
    stance: null,
    basis: `本方主体标注为「${party.label}」，无法判定收付方向`,
    decidedByPartyId: party.id,
  };
}

/** Why a rule holds — or does not — under each stance. */
export interface RuleStanceApplicability {
  stances: readonly ContractStance[];
  /** The reason, rendered to a reviewer who wants to challenge the scoping. */
  rationale: string;
}

/**
 * Which stance each rule is valid under.
 *
 * A rule limited to one stance is not a rule that "matters less" in the other —
 * it is a rule whose premise is false there. Capping the advance payment we make
 * protects our cash; the same cap applied to money coming in would flag our own
 * best terms as a violation.
 *
 * Rules listed under both stances still apply for different reasons, noted in
 * the rationale, because a reviewer adjusting a threshold needs to know which
 * side the number is protecting.
 */
export const RULE_STANCE_APPLICABILITY: Record<RuleCode, RuleStanceApplicability> = {
  ADVANCE_PAYMENT_LIMIT: {
    stances: ["procurement"],
    rationale:
      "预付比例上限保护付款方的资金占用。本方收款时预付越高越有利，套用上限会把对本方最有利的条款判为违规。",
  },
  PAYMENT_TERM_LIMIT: {
    stances: ["revenue", "procurement"],
    rationale:
      "收入立场下是回款周期风险；采购立场下是《保障中小企业款项支付条例》60 日的合规底线。两侧成立，但保护对象相反。",
  },
  BACK_TO_BACK_PAYMENT_CLAUSE: {
    stances: ["procurement"],
    rationale:
      "背靠背付款条款是本方作为付款方把回款风险传导给下家的手段，只有支出合同里才有可能约定。",
  },
  PENALTY_RATIO_LIMIT: {
    stances: ["revenue", "procurement"],
    rationale:
      "违约金比例过高对承担方不利。收入立场下审本方要承担的罚则，采购立场下过高的罚则可能被下家依民法典 585 条主张调减而失去约束力。",
  },
  PERFORMANCE_BOND_RATIO_LIMIT: {
    stances: ["revenue"],
    rationale:
      "履约保证金由供方缴纳。本方作为供方时是自有资金被占用；作为采购方时由下家缴纳，比例高对本方无害。",
  },
  DEPOSIT_RATIO_LIMIT: {
    stances: ["revenue"],
    rationale: "保证金同样由供方缴纳，占用的是本方资金，只在收入立场下构成风险。",
  },
  BID_BOND_RATIO_LIMIT: {
    stances: ["revenue"],
    rationale: "投标保证金由投标方缴纳，本方投标即本方出资。",
  },
  WARRANTY_RETENTION_RATIO_LIMIT: {
    stances: ["revenue"],
    rationale: "质保金从供方应收款中扣留，本方作为供方时直接减少回款。",
  },
  DISPUTE_JURISDICTION: {
    stances: ["revenue", "procurement"],
    rationale: "异地应诉的成本与不确定性与收付方向无关，两侧都应争取本方所在地管辖。",
  },
  DISPUTE_RESOLUTION_CONFLICT: {
    stances: ["revenue", "procurement"],
    rationale: "同一合同内诉讼与仲裁并存会导致条款无效或程序争议，与立场无关。",
  },
  TERMINATION_CLAUSE_PRESENT: {
    stances: ["revenue", "procurement"],
    rationale: "缺少终止条款使任何一方都无法有序退出，两侧都成立。",
  },
  IP_OWNERSHIP_MISSING: {
    stances: ["revenue", "procurement"],
    rationale:
      "知识产权归属缺失在两侧都会引发争议，但诉求相反：收入侧本方希望保留，采购侧本方希望取得。",
  },
  GUARANTEE_MODE_AMBIGUOUS: {
    stances: ["revenue", "procurement"],
    rationale: "担保方式约定不明（一般保证或连带责任保证）会被推定为连带责任，与立场无关。",
  },
  CONFIDENTIALITY_PERIOD_MISSING: {
    stances: ["revenue", "procurement"],
    rationale: "保密期限缺失使义务边界不清，两侧都成立。",
  },
  FORCE_MAJEURE_OVERBROAD: {
    stances: ["revenue", "procurement"],
    rationale: "不可抗力范围过宽会成为对方免责通道，两侧都需收敛。",
  },
  LIABILITY_CAP_MISSING: {
    stances: ["revenue", "procurement"],
    rationale:
      "缺少赔偿上限使本方敞口无界。真实卷宗里支出合同的 10% 上限已超过项目全年毛利，说明即使有上限也需与毛利对照。",
  },
  SUBJECT_RED_LINE_RISK: {
    stances: ["revenue", "procurement"],
    rationale: "两侧都要核验，但维度不同：收入侧看客户的付款能力，采购侧看供应商的失信与经营异常。",
  },
  PARTY_HISTORY_ASSOCIATION: {
    stances: ["revenue", "procurement"],
    rationale: "同一对手方的历史问题在两侧都是有效信号。",
  },
  AMOUNT_IN_WORDS_MISMATCH: {
    stances: ["revenue", "procurement"],
    rationale:
      "大小写金额不一致是合同本身的缺陷，与本方收付方向无关；按惯例大写为准，两侧都可能因此少收或多付。",
  },
};

/**
 * Whether a rule's premise holds in this stance. An unknown stance applies
 * every rule: declining to judge is worse than judging under a stated
 * assumption a reviewer can see.
 */
export function isRuleApplicableInStance(
  ruleCode: RuleCode,
  stance: ContractStance | null,
): boolean {
  if (stance === null) return true;
  return RULE_STANCE_APPLICABILITY[ruleCode].stances.includes(stance);
}

export const getContractStanceLabel = (stance: ContractStance | null): string =>
  stance === "revenue" ? "收入合同" : stance === "procurement" ? "支出合同" : "立场未判定";
