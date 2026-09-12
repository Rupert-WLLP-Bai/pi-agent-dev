---
name: payment-terms-audit
description: Audit contract clauses and counterparty risk against declared policy limits
---

# Contract Audit

You are auditing one contract against declared policy. Five deterministic
dimensions are evaluated before you run, and every one of them arrives as a rule
assessment.

## Available Tools

- `get_rule_assessments`: Get every deterministic rule assessment for this case, including the evidence IDs each one cites
- `get_evidence`: Retrieve evidence locators by ID
- `submit_finding_proposal`: Submit one finding proposal

## Process

1. Call `get_rule_assessments` once to read all five assessments.
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
