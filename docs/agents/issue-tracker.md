# Issue tracker: GitHub

Repository: https://github.com/Rupert-WLLP-Bai/pi-agent-dev

GitHub Issues tracks work and ticket status. Use `gh` with
`--repo Rupert-WLLP-Bai/pi-agent-dev` for issue operations.

## Conventions

- Create: `gh issue create --repo Rupert-WLLP-Bai/pi-agent-dev --title "..." --body-file <file>`.
- Read: `gh issue view <number> --repo Rupert-WLLP-Bai/pi-agent-dev --json number,title,body,labels,comments`.
- List: `gh issue list --repo Rupert-WLLP-Bai/pi-agent-dev --state open --json number,title,body,labels`.
- Comment: use `gh issue comment` with `--body-file` for multiline content.
- Apply/remove labels: use `gh issue edit --add-label` / `--remove-label`.
- Close: use `gh issue close` with the resolution recorded.
- Use native sub-issues/dependencies where supported; otherwise record
  `Part of #<parent>` and `Blocked by: #<number>` links.
- Every issue mutation targets this repository explicitly.

## Specifications

When a skill asks to publish a spec or ticket, create or update its GitHub issue.
Detailed design documents may remain in `docs/design/`; link the versioned
document from the issue and keep work status in the tracker.
Setup itself does not publish the existing Backlog as issues.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding

Use a `wayfinder:map` issue to link child tickets.
Tickets record their parent, blockers and driving developer.
A ticket is actionable when its blockers are closed and it is unassigned.
Record the result and supporting evidence before closing it.
