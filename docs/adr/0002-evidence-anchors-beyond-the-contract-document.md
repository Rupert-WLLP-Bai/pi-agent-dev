---
status: accepted
---

# Let Evidence Locators anchor outside the Contract Document

Subject verification makes findings cite records that come from an external provider rather than from the contract text, so `Evidence Locator` is widened from "a span inside the Contract Document" to "a stable location inside a Source Record": either a bounded span of the Contract Document, or a named record the Source Record reports. Evidence itself is unchanged — still anchored to a Source Record, still excluding model confidence and generated prose. A verification response is therefore an ordinary Source Record and needs no new domain term.

## Revision — four anchor families (2026-09)

The model now recognises four locator kinds, each answering a different “where did this cited fact come from?” question:

| Kind | Anchors to | Typical use |
|------|------------|-------------|
| `DOCUMENT_SPAN` | A block/offset in the Contract Document IR | Contract clauses, numeric terms |
| `EXTERNAL_RECORD` | A named provider record (tool + subject + capture time) | Subject verification, registry lookups |
| `PRIOR_CASE_RECORD` | A reviewed finding on an earlier Audit Case for the same party | Party history association |
| `POLICY_PARAMETER` | A key on a published Rule Version (not contract text) | Deterministic thresholds such as advance-payment limits |

`PRIOR_CASE_RECORD` and `POLICY_PARAMETER` were added after the original ADR: party-history rules need to cite what a prior reviewer decided without rewriting that case, and payment rules must not fake a `DOCUMENT_SPAN` for a threshold that only exists in governance parameters. Snapshots remain immutable — older evidence shapes stay readable in the UI.

## Considered Options

- Keeping the locator document-bound and adding a parallel "External Reference" concept would have preserved the original wording, but it splits the single reviewer-facing evidence list into two unrelated models and forces every Finding to carry two citation shapes.
- Leaving verification results out of the evidence chain would have avoided this change, but then a finding could never cite the external record that justifies it, and the claim of an auditable trail would be false for the subject dimension.
- Representing policy limits as a synthetic `DOCUMENT_SPAN` (`blockId: "policy-limit"`) kept one shape but implied the contract contained that sentence; reviewers could not distinguish governance input from extracted text.

## Consequences

Rules and Findings now cite Evidence by ID without assuming a block location, so consumers that highlight contract text must branch on the locator shape. Verification records are stored as Source Records carrying their provider and capture time, which is what makes staleness visible and re-verification reproducible. Policy parameters cite the Rule Version id and parameter key so a past assessment can be traced to the exact published threshold, even when the contract never mentions it.
