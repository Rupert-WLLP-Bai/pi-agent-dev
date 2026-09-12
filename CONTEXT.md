# Contract Audit Product MVP

This context describes the product language for a minimal, traceable contract-audit workflow. It is independent from the benchmark and evaluation objects in the sibling `agent-comp` repository.

## Language

**Contract**:
A business agreement whose revisions may be reviewed by one or more audit cases.
_Avoid_: Contract Fixture, document

**Contract Revision**:
An immutable version of a Contract that forms the subject of an Audit Case.
_Avoid_: Contract Fixture, latest contract

**Contract Party**:
A natural or legal person named as a signatory of a Contract Revision. What is known about it comes from Facts extracted out of the Contract Document, or from Evidence anchored to a Source Record obtained elsewhere.
_Avoid_: subject, counterparty, company, entity

**Source Record**:
An immutable snapshot or stable reference to source information, including where it came from and when it was captured.
_Avoid_: raw data, context

**Contract Document**:
The normalized document representation of one Contract Revision, derived from a Source Record and preserving stable locations for its content. It contains no audit conclusions.
_Avoid_: Unified Data Model, parsed result, Audit Context

**Fact**:
A typed business statement derived deterministically from one or more Source Records, with traceable lineage back to those records.
_Avoid_: model opinion, Finding

**Rule Assessment**:
A deterministic evaluation of typed Facts under a declared policy or rule version. An Agent may explain it but cannot override it.
_Avoid_: Agent opinion, Finding Proposal, model judgment

**Bounded Audit Context**:
The explicit, time-bounded set of Facts and supporting Evidence made available for one Audit Case.
_Avoid_: Unified Data Model, complete context, raw context dump

**Audit Case**:
The review process for one Contract Revision against a declared Bounded Audit Context.
_Avoid_: task, Agent session, Experiment Run

**Audit Snapshot**:
An immutable capture of the Contract Document, Facts, policy inputs, and time bounds used to assemble the Bounded Audit Context for an Audit Case.
_Avoid_: Unified Data Model, mutable context, latest data

**Agent Run**:
One recorded attempt to obtain a Finding Proposal from the audit Agent for an Audit Case. It is not the Audit Case itself and does not own business state.
_Avoid_: Audit Case, task, session

**Audit Event**:
A stable, business-facing notification about progress or state change in an Audit Case. It is produced by the audit orchestrator rather than copied from Pi runtime events.
_Avoid_: Pi event, token delta, raw tool event

**Audit Stage**:
The current automated activity within a running Audit Case, reported separately from the case's business status.
_Avoid_: Audit Case status, Pi event

**Interrupted Audit Case**:
An Audit Case whose active execution ended because its host process stopped before reaching a business outcome. Retrying it creates a new Agent Run rather than pretending the interrupted run continued.
_Avoid_: failed finding, resumed session

**Evidence**:
Traceable support for a Fact or Finding Proposal, anchored to a Source Record. Model reasoning, confidence, and generated prose are not Evidence.
_Avoid_: explanation, confidence, citation without a source locator

**Evidence Locator**:
The stable identity and bounded location of Evidence within a particular Source Record. The location is either a span of the Contract Document or a named record that the Source Record reports. Quoted text alone is not an Evidence Locator.
_Avoid_: quote, page description, model citation

**Finding Proposal**:
A machine-produced risk claim that cites Evidence and awaits Human Review.
_Avoid_: final finding, Prediction, alert

**Needs Human Review**:
The disposition of a Finding Proposal when its evidence is insufficient or conflicting and no deterministic policy authorizes automatic resolution.
_Avoid_: Agent refusal, unknown error, automatic rejection

**Human Review**:
A person's explicit decision to accept or reject a Finding Proposal, with an optional reason.
_Avoid_: Ground Truth, automatic approval

**Finding Revision**:
An append-only version of a finding created from a Finding Proposal or Human Review; later revisions supersede rather than overwrite earlier ones.
_Avoid_: mutable finding, final result
