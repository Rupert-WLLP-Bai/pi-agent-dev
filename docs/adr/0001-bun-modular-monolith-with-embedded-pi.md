---
status: accepted
---

# Use a Bun modular monolith with an embedded Pi runtime

The product MVP will use a Bun and TypeScript modular monolith: React is served as a separate web application, Elysia owns the HTTP boundary and application composition, the deterministic audit core remains independent of transport and persistence, and Pi is embedded in-process behind an audit-agent port. This replaces the earlier Python API to TypeScript Agent service boundary, keeps business and tool contracts in one type system, and still permits naturally Python-based document parsing such as MinerU to remain an external adapter.

Pi may organize evidence, explain risk, and propose remediation, but it cannot override deterministic rule results. The Agent receives only a bounded audit context through allowlisted domain tools; shell access, arbitrary file writes, unrestricted HTTP, and arbitrary database access are excluded.

## Considered Options

- FastAPI plus a separate Pi service preserves the earlier Python boundary but adds RPC contracts and two application runtimes without benefiting this TypeScript-first MVP.
- A standalone Pi service improves process isolation but adds deployment and failure modes before concurrent or independently scalable Agent workloads exist.

## Consequences

The MVP starts with four workspaces: `apps/web`, `apps/api`, `packages/audit`, and `packages/pi-agent`. PostgreSQL and Drizzle remain infrastructure owned by the API composition layer until another real consumer justifies a separate package. Document adapters normalize inputs into Contract Documents; they do not create Facts or Findings.
