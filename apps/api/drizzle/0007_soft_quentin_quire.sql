/* Reconciliation no-op: the tables below already exist in every environment —
   migrations 0003–0006 were authored in parallel worktrees with divergent
   drizzle snapshot parents. This migration exists only to re-anchor the
   snapshot chain (0007_snapshot matches apps/api/src/db/schema.ts exactly) so
   future `drizzle-kit generate` diffs against the real schema. */
