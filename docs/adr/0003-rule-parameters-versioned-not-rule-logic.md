---
status: accepted
---

# Version rule parameters instead of replacing rule logic

Rules are deterministic TypeScript functions (detection + threshold logic). What the product versions and publishes is the **parameter set** each rule runs with — numeric thresholds, jurisdiction preferences, and clause stances (首选 / 可接受退让 / 不可接受 / 例外审批) — stored as immutable `rule_versions` rows. Runtime audit-case creation reads the currently published version and records it on the Rule Assessment, so every Audit Snapshot cites the exact parameter set that produced its deterministic results.

Publishing is gated: a version may only be published after a Validation Run over its parameters is green. A dynamic rule engine (DSL / user-authored logic) remains a possible future direction but was deliberately out of scope.

## Considered Options

- A full dynamic rule engine (expressions authored in the UI) would let rule editors change logic, not just parameters, but multiplies implementation surface, adds an interpretation security boundary, and cannot reuse the compile-time-checked golden-set bench as a gate.
- Metadata-only rule CRUD (display without runtime effect) would be dishonest for a compliance product: the list would claim rules the engine ignores.

## Consequences

Rule edits in the product are parameter/stance edits that create a new draft version; the logic itself changes only via code changes through the golden-set regression bench. The rule table's "最近验证" column and the publish button's disabled-with-reason state both derive from Validation Runs. Audit Snapshots stay reproducible because their Rule Assessments pin the rule version used.
