import { clauseEvidence, extractDuration, findClause, numberParam } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment, RuleParamSet } from "./model";

export const PAYMENT_TERM_RULE_CODE = "PAYMENT_TERM_LIMIT" as const;

/** 《保障中小企业款项支付条例》第九条：付款期限最长不得超过 60 日。 */
export const DEFAULT_PAYMENT_TERM_MAX_DAYS = 60;

const EVIDENCE_ID = "contract-payment-term";
/** A payment action outranks a bare price/settlement mention as the clause. */
const ACTION_KEYWORD = /支付|付款/u;
const SETTLEMENT_KEYWORD = /价款|结算/u;

export interface PaymentTermFacts {
  hasPaymentClause: boolean;
  /** Agreed payment term in natural days; null when the contract fixes none. */
  days: number | null;
  label: string;
}

export interface PaymentTermAnalysis {
  facts: PaymentTermFacts;
  evidence: EvidenceLocator[];
}

/**
 * Reads the payment term from the first clause that actually pays. A contract
 * that pays but never fixes a term yields `days: null` and a human review,
 * because an unfixed term is the risk the regulation closes — it is not the
 * same as a compliant short term.
 */
export function buildPaymentTermFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): PaymentTermAnalysis {
  const hit =
    findClause(input.document, ACTION_KEYWORD) ?? findClause(input.document, SETTLEMENT_KEYWORD);
  if (hit === null) {
    return {
      facts: { hasPaymentClause: false, days: null, label: "付款期限" },
      evidence: [],
    };
  }

  const evidence = clauseEvidence({
    id: EVIDENCE_ID,
    sourceRecordId: input.sourceRecordId,
    document: input.document,
    hit,
  });
  const duration = extractDuration(hit.window);

  return {
    facts: {
      hasPaymentClause: true,
      days: duration === null ? null : duration.days,
      label: "付款期限",
    },
    evidence: [evidence],
  };
}

export function evaluatePaymentTermRule(
  facts: PaymentTermFacts,
  params?: RuleParamSet,
): RuleAssessment {
  const maxDays = numberParam(params, "maxDays", DEFAULT_PAYMENT_TERM_MAX_DAYS);
  const maxDaysPercent = Math.round(maxDays);

  if (!facts.hasPaymentClause) {
    return {
      id: "assessment-payment-term",
      ruleCode: PAYMENT_TERM_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: "合同未约定付款条款，不涉及付款期限上限。",
    };
  }

  if (facts.days === null) {
    return {
      id: "assessment-payment-term",
      ruleCode: PAYMENT_TERM_RULE_CODE,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: [EVIDENCE_ID],
      basis: `检出付款条款，但未载明明确付款期限，存在付款期限不确定风险，需人工确认（法定最长 ${maxDaysPercent} 日）。`,
    };
  }

  const conflict = facts.days > maxDays;
  return {
    id: "assessment-payment-term",
    ruleCode: PAYMENT_TERM_RULE_CODE,
    disposition: conflict ? "POLICY_CONFLICT" : "COMPLIANT",
    evidenceIds: [EVIDENCE_ID],
    basis: conflict
      ? `约定付款期限约 ${Math.round(facts.days)} 日，超过法定最长 ${maxDaysPercent} 日。`
      : `约定付款期限约 ${Math.round(facts.days)} 日，未超过法定最长 ${maxDaysPercent} 日。`,
  };
}
