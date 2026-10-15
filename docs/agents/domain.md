# Domain Docs

## Layout

Single-context across `packages/audit`, `packages/pi-agent`, `apps/api`
and `apps/web`.

- `GLOSSARY.md`: shared domain vocabulary.
- `CONTEXT.md`: existing source of domain language.
- `docs/adr/`: shared architecture decisions.

## Consumer rules

Before exploring domain code, read the root `GLOSSARY.md`.
When changing domain concepts, also read `CONTEXT.md`.
Read ADRs relevant to the area being changed.

Use the glossary's terms in specs, issues, code and tests.
Raise vocabulary gaps through domain modeling.
Surface conflicts with accepted ADRs explicitly before proposing a change.

If a referenced document is absent, continue with existing sources.
Create domain documents when a real terminology or decision gap is resolved.
