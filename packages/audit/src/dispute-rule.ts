import type { ContractDocument, EvidenceLocator, RuleAssessment } from "./model";

export const DISPUTE_JURISDICTION_RULE_CODE = "DISPUTE_JURISDICTION" as const;

export interface DisputeJurisdictionFacts {
  /** "litigation" | "arbitration" | null when no dispute clause found. */
  resolutionMethod: "litigation" | "arbitration" | null;
  /**
   * The jurisdiction named in the dispute clause: either a place name
   * (e.g. "重庆市南岸区") or a referential phrase (e.g. "甲方所在地").
   */
  jurisdiction: string | null;
  /**
   * How the jurisdiction was determined. REFERENTIAL_OUR_SIDE and
   * REFERENTIAL_COUNTERPARTY come from phrases like "甲方所在地"; INDETERMINATE
   * covers phrases the rule cannot settle (合同签订地, 被告住所地).
   */
  jurisdictionKind:
    | "NAMED_PLACE"
    | "REFERENTIAL_OUR_SIDE"
    | "REFERENTIAL_COUNTERPARTY"
    | "INDETERMINATE"
    | null;
}

export interface DisputeJurisdictionAnalysis {
  facts: DisputeJurisdictionFacts;
  evidence: EvidenceLocator[];
}

/** Phrases that anchor the dispute to a named court or arbitration body. */
const DISPUTE_METHOD_PATTERN = /仲裁|诉讼|法院|起诉/u;

/** Verbs and prepositions that precede the institution name. */
const LEADING_NOISE = /^(?:提交|起诉|申请|向|在|至|到|于|由|对|与|和|及|或)+/u;

const OUR_SIDE_ROLES = /(?:甲方|买方|采购方|需方|发包方|建设单位)(?:所在地|住所地)/u;
const COUNTERPARTY_ROLES = /(?:乙方|卖方|供货方|供方|承包方|承包单位)(?:所在地|住所地)/u;
const INDETERMINATE_REFERENCES =
  /(?:合同|协议)(?:签订地|签署地|履行地)|被告(?:住所地|所在地)|原告(?:住所地|所在地)/u;

/**
 * Extracts the dispute resolution method and jurisdiction from the contract.
 *
 * The clause is read in three passes so that the common referential phrasings
 * real contracts use never masquerade as a place name:
 *
 * 1. Referential — "甲方所在地人民法院" resolves to our side, "乙方所在地"
 *    to the counterparty, "合同签订地/被告住所地" is indeterminate.
 * 2. Named institution — a greedy CJK run before 人民法院/仲裁委员会, with
 *    leading verbs stripped, yields the place ("向重庆市南岸区人民法院" →
 *    "重庆市南岸区").
 * 3. Region containment — "重庆市南岸区" contains "重庆", so a district inside
 *    our own city is NOT flagged as a remote jurisdiction.
 */
export function buildDisputeJurisdictionFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
  /** Our side's preferred jurisdiction (e.g. "重庆"). */
  preferredJurisdiction: string;
}): DisputeJurisdictionAnalysis {
  for (const block of input.document.blocks) {
    const text = block.text;
    if (!/争议|纠纷|管辖|仲裁|诉讼|法院|起诉/u.test(text)) continue;
    if (!DISPUTE_METHOD_PATTERN.test(text)) continue;

    const method: "litigation" | "arbitration" = /仲裁/u.test(text) ? "arbitration" : "litigation";

    // Pass 1: referential jurisdictions.
    if (OUR_SIDE_ROLES.test(text)) {
      return resolved(input, block, method, "甲方所在地", "REFERENTIAL_OUR_SIDE");
    }
    if (COUNTERPARTY_ROLES.test(text)) {
      return resolved(input, block, method, "乙方所在地", "REFERENTIAL_COUNTERPARTY");
    }
    if (INDETERMINATE_REFERENCES.test(text)) {
      return resolved(input, block, method, "合同签订地/被告住所地", "INDETERMINATE");
    }

    // Pass 2: a named institution. The greedy run captures the full
    // administrative division ("重庆市南岸区"), unlike a lazy one which
    // truncates it into garbage like "市南岸区".
    const institution = text.match(
      /([\u4e00-\u9fff]{2,10})(?:人民法院|中级法院|仲裁委员会|仲裁院)/u,
    );
    if (institution === null) {
      // A dispute method is agreed but no institution is named.
      return resolved(input, block, method, null, null);
    }
    const place = institution[1].replace(LEADING_NOISE, "");
    if (place.length < 2) {
      return resolved(input, block, method, null, null);
    }
    return resolved(input, block, method, place, "NAMED_PLACE");
  }

  return {
    facts: { resolutionMethod: null, jurisdiction: null, jurisdictionKind: null },
    evidence: [],
  };
}

function resolved(
  input: { sourceRecordId: string; document: ContractDocument; preferredJurisdiction: string },
  block: { blockId: string },
  method: "litigation" | "arbitration",
  jurisdiction: string | null,
  jurisdictionKind: DisputeJurisdictionFacts["jurisdictionKind"],
): DisputeJurisdictionAnalysis {
  const quotedText = blockText(input, block.blockId);
  return {
    facts: { resolutionMethod: method, jurisdiction, jurisdictionKind },
    evidence: [
      {
        id: "contract-dispute",
        sourceRecordId: input.sourceRecordId,
        location: {
          kind: "DOCUMENT_SPAN",
          contractDocumentHash: input.document.hash,
          blockId: block.blockId,
          startOffset: 0,
          endOffset: Array.from(quotedText).length,
          quotedText,
        },
      },
    ],
  };
}

function blockText(
  input: { document: ContractDocument },
  blockId: string,
): string {
  const block = input.document.blocks.find((item) => item.blockId === blockId);
  const text = block?.text ?? "";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function evaluateDisputeJurisdictionRule(
  facts: DisputeJurisdictionFacts,
  preferredJurisdiction: string,
): RuleAssessment {
  if (facts.resolutionMethod === null) {
    return {
      id: "assessment-dispute",
      ruleCode: DISPUTE_JURISDICTION_RULE_CODE,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: [],
      basis: "合同文本中未检出争议解决条款，存在管辖约定缺失风险，需人工确认。",
    };
  }

  const methodLabel = facts.resolutionMethod === "arbitration" ? "仲裁" : "诉讼";

  if (facts.jurisdictionKind === "INDETERMINATE" || facts.jurisdiction === null) {
    return {
      id: "assessment-dispute",
      ruleCode: DISPUTE_JURISDICTION_RULE_CODE,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: ["contract-dispute"],
      basis: `合同约定${methodLabel}方式解决争议，但管辖地（${facts.jurisdiction ?? "未明确"}）无法确定性判定是否对我方有利，需人工确认。`,
    };
  }

  if (facts.jurisdictionKind === "REFERENTIAL_OUR_SIDE") {
    return {
      id: "assessment-dispute",
      ruleCode: DISPUTE_JURISDICTION_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: ["contract-dispute"],
      basis: `争议管辖约定为${facts.jurisdiction}，与我方立场一致。`,
    };
  }

  if (facts.jurisdictionKind === "REFERENTIAL_COUNTERPARTY") {
    return {
      id: "assessment-dispute",
      ruleCode: DISPUTE_JURISDICTION_RULE_CODE,
      disposition: "POLICY_CONFLICT",
      evidenceIds: ["contract-dispute"],
      basis: `争议管辖约定为${facts.jurisdiction}，一旦涉诉需赴相对方所在地应诉，存在异地维权成本风险。`,
    };
  }

  // Named place: region containment, so a district of our own city
  // ("重庆市南岸区" vs "重庆") is not treated as a remote jurisdiction.
  const aligned =
    facts.jurisdiction.includes(preferredJurisdiction)
    || preferredJurisdiction.includes(facts.jurisdiction);

  if (!aligned) {
    return {
      id: "assessment-dispute",
      ruleCode: DISPUTE_JURISDICTION_RULE_CODE,
      disposition: "POLICY_CONFLICT",
      evidenceIds: ["contract-dispute"],
      basis: `争议管辖地为「${facts.jurisdiction}」，与我方所在地「${preferredJurisdiction}」不一致，存在异地${methodLabel}风险。`,
    };
  }

  return {
    id: "assessment-dispute",
    ruleCode: DISPUTE_JURISDICTION_RULE_CODE,
    disposition: "COMPLIANT",
    evidenceIds: ["contract-dispute"],
    basis: `争议管辖地为「${facts.jurisdiction}」，与我方所在地「${preferredJurisdiction}」一致。`,
  };
}
