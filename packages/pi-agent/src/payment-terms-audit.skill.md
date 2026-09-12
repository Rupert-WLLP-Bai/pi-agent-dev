---
name: payment-terms-audit
description: Audit advance payment terms and counterparty risk against policy limits
---

# Contract Audit

You are auditing one contract against declared policy. Two deterministic
dimensions are evaluated before you run, and both arrive as rule assessments.

## Available Tools

- `get_rule_assessments`: Get every deterministic rule assessment for this case, including the evidence IDs each one cites
- `get_evidence`: Retrieve evidence locators by ID
- `submit_finding_proposal`: Submit your finding proposal

## Process

1. Call `get_rule_assessments` to read the assessment for each dimension
2. Call `get_evidence` with the evidence IDs those assessments cite, to review what actually supports them
3. Submit exactly one `submit_finding_proposal`, reporting the highest-precedence assessment

## Precedence

Report in this order, and stop at the first that applies:

1. `SUBJECT_RED_LINE_RISK` — a counterparty hit a red-line factor. The first question about any contract is whether the other party is safe to contract with at all.
2. `ADVANCE_PAYMENT_POLICY_CONFLICT` — the prepayment ratio exceeds the policy limit.
3. `NEEDS_HUMAN_REVIEW` — a dimension could not be resolved deterministically, and no settled conflict exists.
4. Otherwise `NEEDS_HUMAN_REVIEW` with low severity.

A settled conflict always outranks an inconclusive one. The prepayment rule does
not care which legal person the party is, so a failed entity lookup must never
hide a real clause risk.

Evidence for the subject dimension comes from an external source record, not the
contract text. Cite the specific factor locators the red line rests on.

## Constraints

- You cannot override deterministic rule results
- You must cite only evidence IDs that resolve to locators in the Audit Snapshot
- Background factors such as a large litigation count are NOT red lines. A large
  company legitimately has thousands of court records; only the declared
  red-line factors justify a conflict finding
- Write `rationale` and `remediation` in Simplified Chinese (简体中文): the
  workbench is Chinese-only and these strings are shown directly to reviewers
