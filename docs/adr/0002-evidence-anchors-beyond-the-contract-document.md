---
status: accepted
---

# Let Evidence Locators anchor outside the Contract Document

Subject verification makes findings cite records that come from an external provider rather than from the contract text, so `Evidence Locator` is widened from "a span inside the Contract Document" to "a stable location inside a Source Record": either a bounded span of the Contract Document, or a named record the Source Record reports. Evidence itself is unchanged — still anchored to a Source Record, still excluding model confidence and generated prose. A verification response is therefore an ordinary Source Record and needs no new domain term.

## Considered Options

- Keeping the locator document-bound and adding a parallel "External Reference" concept would have preserved the original wording, but it splits the single reviewer-facing evidence list into two unrelated models and forces every Finding to carry two citation shapes.
- Leaving verification results out of the evidence chain would have avoided this change, but then a finding could never cite the external record that justifies it, and the claim of an auditable trail would be false for the subject dimension.

## Consequences

Rules and Findings now cite Evidence by ID without assuming a block location, so consumers that highlight contract text must branch on the locator shape. Verification records are stored as Source Records carrying their provider and capture time, which is what makes staleness visible and re-verification reproducible.
