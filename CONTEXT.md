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

**Contract Stance**:
Which side of the money our own organization is on in one Contract Revision — `revenue` when we are paid, `procurement` when we pay. Read off the Contract Party our organization matches, or declared by the caller. Each rule declares which Contract Stances its premise holds under; a rule evaluated outside them is `NOT_APPLICABLE`, never compliant. Always written in full: bare "stance" is ambiguous with a Rule Version's Negotiation Stance.
_Avoid_: stance (unqualified), direction, contract type, buy/sell, 甲方/乙方 as a synonym for it

**Project Dossier**:
The full set of materials one ICT project accumulates across selection, approval, and signing — including the revenue contract, the procurement contracts signed to deliver it, and the spreadsheets the amounts were modelled in. The unit a cross-document consistency review is scoped to.
_Avoid_: project, folder, package, case

**Dossier Artifact**:
One file within a Project Dossier, carrying which stage it belongs to and which template it instantiates. It becomes a Source Record when read.
_Avoid_: attachment, document, file

**Back-to-Back Pair**:
The revenue Contract Revision and the procurement Contract Revision covering the same scope in one Project Dossier. The pair is what a term or amount mismatch is asserted between.
_Avoid_: contract pair, upstream/downstream, 上下游

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

**Remediation Item**:
The tracked corrective work created from a Human Review that accepted a Finding Revision. It advances 待整改 → 整改中 → 待复核, and only a reviewer who is not its owner may close it. Closing writes back to the originating audit case as closure evidence.
_Avoid_: task, ticket, work order

**Rule Version**:
An immutable published parameter set (thresholds, Negotiation Stances) of one rule. Deterministic rule logic lives in code; a version only carries the parameters it was run with. Publishing a version retires the previously published one; versions already referenced by an Audit Snapshot are never mutated.
_Avoid_: rule config, rule settings, rule override

**Negotiation Stance**:
What one rule instructs a negotiator to hold, retreat to, and refuse — the `preferred` / `acceptableRetreat` / `unacceptable` triple carried by a Rule Version. A drafting position, not a side of the money: it is a different concept from Contract Stance and the two must never be shortened to the same word.
_Avoid_: stance (unqualified), Contract Stance, position

**Validation Case**:
A labelled contract fixture (正例 / 反例 / 边界例 / 历史误报 / 证据缺失) used to exercise one rule's logic deterministically. The code-level golden set remains the canonical source; persisted cases are its materialization for the product UI.
_Avoid_: test case, eval sample, training data

**Validation Run**:
One recorded execution of validation cases against one Rule Version's parameters, persisted with per-case expected/actual results. It is compared against the prior run of the same rule to surface regressions; 证据缺失 (needs review) counts neither as pass nor failure.
_Avoid_: benchmark, evaluation, score

**Rule Code**:
The stable identifier of one deterministic rule in the engine catalogue (for example `ADVANCE_PAYMENT_LIMIT`). Finding Proposals cite a Rule Assessment by id; the resolved Rule Code is denormalized for queries and revision diff.
_Avoid_: finding type alone, rule name string

**Audit Snapshot Policy**:
The enabled rule overlay and parameter overrides frozen into one Audit Snapshot generation — which rules ran and which Rule Version ids supplied thresholds at audit time.
_Avoid_: runtime config, latest policy

**Agent Trace**:
The ordered log of an Agent Run: stages, tool calls, tool results, and assistant messages. It records what the agent did, not the business conclusions.
_Avoid_: session dump, chat log

**Subject Verification**:
One external lookup pass for a Contract Party against a provider Source Record, producing match status, risk dimensions, and Evidence Locators cited by the subject rule.
_Avoid_: counterparty check (generic), company API response

**Party History Run**:
The deterministic evaluation of prior reviewed findings on the same Contract Party, frozen into one Audit Case as Evidence and a Rule Assessment.
_Avoid_: CRM history, manual memory
