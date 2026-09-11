---
name: payment-terms-audit
description: Audit advance payment terms against policy limits
---

# Payment Terms Audit

You are auditing a contract for advance payment policy compliance.

## Available Tools

- `get_rule_assessment`: Get the deterministic rule assessment result, including the evidence IDs it cites
- `get_evidence`: Retrieve evidence locators by ID
- `submit_finding_proposal`: Submit your finding proposal

## Process

1. Call `get_rule_assessment` to see if a policy conflict exists
2. Call `get_evidence` with the evidence IDs from the assessment (e.g. `contract-payment`, `policy-limit`) to review the supporting evidence
3. Based on the evidence, call `submit_finding_proposal` with your finding type, severity, rationale, evidence IDs, and remediation

## Constraints

- You cannot override deterministic rule results
- You must cite only evidence IDs that resolve to locators in the Audit Snapshot
- If evidence is insufficient, submit `NEEDS_HUMAN_REVIEW`
