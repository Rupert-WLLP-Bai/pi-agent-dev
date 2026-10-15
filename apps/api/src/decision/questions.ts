import type { DecisionQuestion, DecisionTaskType } from "@contract-audit/audit/decision";

/**
 * One entry of the server-controlled question catalogue.
 *
 * A question is *data*, authored here and versioned: the contract text can
 * never introduce, rewrite or extend one, which is what stops a document from
 * asking the model something the product did not decide to ask. Options are
 * unique by construction — the catalogue is the only place they are declared.
 */
export interface DecisionQuestionEntry {
  key: string;
  /** Bumped whenever the wording, options or criteria of this question change. */
  version: string;
  taskType: DecisionTaskType;
  question: DecisionQuestion;
  /** What the question is for, in the product's own vocabulary. */
  purpose: string;
}

/** The catalogue version, cited by every advice derived from it. */
export const DECISION_QUESTION_CATALOGUE_VERSION = "question-catalogue-v1";

/**
 * The controlled questions. Each one asserts a single proposition the shadow
 * path may observe; conflicts are only ever computed against a rule
 * assessment of that same proposition.
 */
export const decisionQuestionCatalogue: readonly DecisionQuestionEntry[] = [
  {
    key: "clause-category",
    version: "clause-category-v1",
    taskType: "clause_category",
    purpose: "判断合成条款的主要类型，用于观察模型对条款语义的理解。",
    question: {
      type: "choice",
      criteria: "请判断本合成合同条款的主要类型。",
      options: [
        "payment",
        "liability",
        "force_majeure",
        "termination",
        "acceptance",
        "dispute",
        "confidentiality",
        "party",
        "amount",
        "attachment_conflict",
      ],
    },
  },
  {
    key: "review-routing",
    version: "review-routing-v1",
    taskType: "review_routing",
    purpose: "判断合成条款是否需要优先人工复核。",
    question: {
      type: "score",
      criteria: "请判断本合成合同条款是否需要优先人工复核。",
      options: [0, 1, 2],
    },
  },
  {
    key: "advance-payment-exceeds-policy",
    version: "advance-payment-v1",
    taskType: "clause_category",
    purpose: "判断合成条款是否约定超过制度上限的预付款比例。",
    question: {
      type: "noul",
      criteria: "该合成条款约定的预付款比例是否超过制度上限？",
    },
  },
];

const catalogueByKey: Record<string, DecisionQuestionEntry | undefined> = Object.fromEntries(
  decisionQuestionCatalogue.map((entry) => [entry.key, entry]),
);

/** Looks a question up by key; unknown keys are a caller bug, not a 404. */
export const decisionQuestionFor = (key: string): DecisionQuestionEntry | undefined =>
  catalogueByKey[key];
