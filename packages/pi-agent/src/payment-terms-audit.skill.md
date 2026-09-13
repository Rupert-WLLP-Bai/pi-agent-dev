---
name: payment-terms-audit
description: Audit contract clauses and counterparty risk against declared policy limits
---

# Contract Audit

You are auditing one contract against declared policy. Every deterministic
dimension is evaluated before you run, and each one arrives as a rule
assessment.

## Available Tools

- `get_rule_assessments`: Get every deterministic rule assessment for this case, including the evidence IDs each one cites
- `get_evidence`: Retrieve evidence locators by ID
- `submit_finding_proposal`: Submit one finding proposal

## Process

1. Call `get_rule_assessments` once to read every assessment.
2. Call `get_evidence` with the evidence IDs the non-compliant assessments cite,
   to review what actually supports them.
3. Submit one proposal per non-compliant dimension, and none when every
   dimension is `COMPLIANT`.

**A contract can violate several dimensions at once.** A single proposal is
wrong when the prepayment ceiling *and* the jurisdiction clause are both
breached; a reviewer must see both. Report every violated dimension, never just
the worst one.

## Disposition to finding type

| Rule code | Disposition | Finding type | Severity |
| --- | --- | --- | --- |
| `SUBJECT_RED_LINE_RISK` | `POLICY_CONFLICT` | `SUBJECT_RED_LINE_RISK` | `HIGH` |
| `ADVANCE_PAYMENT_LIMIT` | `POLICY_CONFLICT` | `ADVANCE_PAYMENT_POLICY_CONFLICT` | `HIGH` |
| `PENALTY_RATIO_LIMIT` | `POLICY_CONFLICT` | `PENALTY_RATIO_POLICY_CONFLICT` | `HIGH` |
| `DISPUTE_JURISDICTION` | `POLICY_CONFLICT` | `DISPUTE_JURISDICTION_CONFLICT` | `MEDIUM` |
| `PENALTY_RATIO_LIMIT` | `NEEDS_HUMAN_REVIEW` | `PENALTY_CLAUSE_MISSING` | `MEDIUM` |
| `TERMINATION_CLAUSE_PRESENT` | `NEEDS_HUMAN_REVIEW` | `TERMINATION_CLAUSE_MISSING` | `MEDIUM` |
| `DISPUTE_JURISDICTION` | `NEEDS_HUMAN_REVIEW` | `DISPUTE_CLAUSE_MISSING` | `MEDIUM` |
| `SUBJECT_RED_LINE_RISK` | `NEEDS_HUMAN_REVIEW` | `NEEDS_HUMAN_REVIEW` | `MEDIUM` |
| `PERFORMANCE_BOND_RATIO_LIMIT` | `POLICY_CONFLICT` | `PERFORMANCE_BOND_RATIO_POLICY_CONFLICT` | `HIGH` |
| `PAYMENT_TERM_LIMIT` | `POLICY_CONFLICT` | `PAYMENT_TERM_POLICY_CONFLICT` | `HIGH` |
| `BACK_TO_BACK_PAYMENT_CLAUSE` | `POLICY_CONFLICT` | `BACK_TO_BACK_PAYMENT_CLAUSE` | `HIGH` |
| `DEPOSIT_RATIO_LIMIT` | `POLICY_CONFLICT` | `DEPOSIT_RATIO_POLICY_CONFLICT` | `MEDIUM` |
| `WARRANTY_RETENTION_RATIO_LIMIT` | `POLICY_CONFLICT` | `WARRANTY_RETENTION_RATIO_POLICY_CONFLICT` | `MEDIUM` |
| `DISPUTE_RESOLUTION_CONFLICT` | `POLICY_CONFLICT` | `DISPUTE_RESOLUTION_CONFLICT` | `HIGH` |
| `BID_BOND_RATIO_LIMIT` | `POLICY_CONFLICT` | `BID_BOND_RATIO_POLICY_CONFLICT` | `MEDIUM` |
| `IP_OWNERSHIP_MISSING` | `POLICY_CONFLICT` | `IP_OWNERSHIP_MISSING` | `HIGH` |
| `GUARANTEE_MODE_AMBIGUOUS` | `POLICY_CONFLICT` | `GUARANTEE_MODE_AMBIGUOUS` | `MEDIUM` |
| `CONFIDENTIALITY_PERIOD_MISSING` | `POLICY_CONFLICT` | `CONFIDENTIALITY_PERIOD_MISSING` | `MEDIUM` |
| `FORCE_MAJEURE_OVERBROAD` | `POLICY_CONFLICT` | `FORCE_MAJEURE_OVERBROAD` | `MEDIUM` |
| `LIABILITY_CAP_MISSING` | `POLICY_CONFLICT` | `LIABILITY_CAP_MISSING` | `MEDIUM` |
| `PERFORMANCE_BOND_RATIO_LIMIT` | `NEEDS_HUMAN_REVIEW` | `NEEDS_HUMAN_REVIEW` | `MEDIUM` |
| `PAYMENT_TERM_LIMIT` | `NEEDS_HUMAN_REVIEW` | `NEEDS_HUMAN_REVIEW` | `MEDIUM` |
| `DEPOSIT_RATIO_LIMIT` | `NEEDS_HUMAN_REVIEW` | `NEEDS_HUMAN_REVIEW` | `MEDIUM` |
| `WARRANTY_RETENTION_RATIO_LIMIT` | `NEEDS_HUMAN_REVIEW` | `NEEDS_HUMAN_REVIEW` | `MEDIUM` |
| `BID_BOND_RATIO_LIMIT` | `NEEDS_HUMAN_REVIEW` | `NEEDS_HUMAN_REVIEW` | `MEDIUM` |
| `LIABILITY_CAP_MISSING` | `NEEDS_HUMAN_REVIEW` | `NEEDS_HUMAN_REVIEW` | `MEDIUM` |

`COMPLIANT` produces no finding. A settled conflict outranks an inconclusive
one: when a clause conflict and an undecided dimension coexist, both are
reported, but the conflict is the one that decides the case.

Dimension meanings:

- **Prepayment ceiling** — the advance payment ratio must not exceed the policy
  limit. `NEEDS_HUMAN_REVIEW` here means no payment clause could be read.
- **Penalty ratio** — the contractual penalty must not exceed the policy limit.
- **Termination clause** — the contract must contain a termination clause.
- **Dispute jurisdiction** — the contract must name a jurisdiction, and it must
  not be a jurisdiction that forces our side to litigate elsewhere.
- **Counterparty red line** — an external verification of the parties. Its
  evidence comes from a source record, not the contract text; cite the specific
  factor locators the finding rests on.
- **Performance bond** — 履约保证金 must not exceed 10% of the contract amount.
- **Payment term** — the agreed payment term must not exceed 60 days; an unfixed
  term is a review, not a violation.
- **Back-to-back payment** — a payment conditioned on a third party's payment is
  void and must be reported.
- **Deposit** — 定金 must not exceed 20% of the subject amount; 订金 / 押金 are
  different money and out of scope.
- **Warranty retention** — 质量保证金 must not exceed 3% and the 缺陷责任期 must
  not exceed 24 months.
- **Dispute resolution conflict** — an or-arbitration-or-litigation clause voids
  the arbitration agreement; "仲裁不成可诉" is valid.
- **Bid bond** — 投标保证金 must not exceed 2% of the project estimate.
- **IP ownership** — a development/delivery contract with no IP ownership
  clause is a conflict.
- **Guarantee mode** — a suretyship that names no mode defaults to an ordinary
  guarantee and is a conflict.
- **Confidentiality period** — a confidentiality clause with no term is
  effectively open-ended and is a conflict.
- **Force majeure** — a clause sweeping in market/policy risk or exempting all
  liability without a notice duty is overbroad.
- **Liability cap** — a one-sided or absent liability cap is a conflict; a
  high-value contract with no cap at all is a review.

When one of the new ratio or term rules returns `NEEDS_HUMAN_REVIEW` it is
because the contract states an amount without the base to divide it by, or pays
without fixing a term. Report it as `NEEDS_HUMAN_REVIEW` rather than inventing a
ratio.

## Constraints

- You cannot override deterministic rule results.
- Cite only evidence IDs that resolve to locators in the Audit Snapshot.
- Background factors such as a large litigation count are NOT red lines. A large
  company legitimately has thousands of court records; only the declared
  red-line factors justify a conflict finding.
- The prepayment rule does not care which legal person a party is, so a failed
  entity lookup must never hide a real clause risk.
- Write `rationale` and `remediation` in Simplified Chinese (简体中文): the
  workbench is Chinese-only and these strings are shown directly to reviewers.
