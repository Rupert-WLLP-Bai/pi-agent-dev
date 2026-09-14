import type {
  AgentRunTrace,
  AgentTraceStep,
  AuditCaseStatus,
  ContractParty,
} from "@contract-audit/audit/model";
import type { AgentRunIdentity } from "@contract-audit/audit/ports";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { agentRuns, agentTraceSteps, auditCases, auditSnapshots } from "../schema";
import { contractTitleFromFirstBlock } from "./helpers";
import { toAgentRun, toTraceStep } from "./mappers";
import type { AgentRunSummary, DrizzleDB } from "./types";

export class AgentTraceRepository {
  constructor(private readonly db: DrizzleDB) {}

  /**
   * Opens an Agent Run before the agent starts.
   *
   * The run row has to exist up front because trace steps reference it — and a
   * trace is most useful while the run is still in flight, not only after it
   * ends. `finishAgentRun` closes it with the outcome.
   */
  async beginAgentRun(input: { auditCaseId: string } & AgentRunIdentity): Promise<string> {
    const [row] = await this.db
      .insert(agentRuns)
      .values({
        auditCaseId: input.auditCaseId,
        provider: input.provider,
        model: input.model,
        version: input.version,
      })
      .returning({ id: agentRuns.id });
    return row.id;
  }

  /** Closes a run. Usage, duration and error are only known once it is over. */

  /** Closes a run. Usage, duration and error are only known once it is over. */
  async finishAgentRun(
    runId: string,
    input: {
      usage: Record<string, number> | null;
      durationMs: number | null;
      error: string | null;
    },
  ): Promise<void> {
    await this.db
      .update(agentRuns)
      .set({ usage: input.usage, durationMs: input.durationMs, error: input.error })
      .where(eq(agentRuns.id, runId));
  }

  /**
   * Records one trace step. A step is identified by (run, sequence), so a
   * repeated write is ignored rather than duplicating the trace.
   */

  /**
   * Records one trace step. A step is identified by (run, sequence), so a
   * repeated write is ignored rather than duplicating the trace.
   */
  async appendAgentTraceStep(auditCaseId: string, step: AgentTraceStep): Promise<void> {
    await this.db
      .insert(agentTraceSteps)
      .values({
        runId: step.runId,
        auditCaseId,
        sequence: step.sequence,
        kind: step.kind,
        at: new Date(step.at),
        label: step.label,
        ref: step.ref,
        input: step.input,
        output: step.output,
        isError: step.isError,
        durationMs: step.durationMs,
        tokens: step.tokens,
      })
      .onConflictDoNothing();
  }

  /** Every run for a case, newest first, each with its steps in execution order. */

  /** Every run for a case, newest first, each with its steps in execution order. */
  async getTracesByCase(caseId: string): Promise<AgentRunTrace[]> {
    const runs = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.auditCaseId, caseId))
      .orderBy(desc(agentRuns.createdAt));
    if (runs.length === 0) return [];

    const stepRows = await this.db
      .select()
      .from(agentTraceSteps)
      .where(eq(agentTraceSteps.auditCaseId, caseId))
      .orderBy(agentTraceSteps.runId, agentTraceSteps.sequence);

    const stepsByRun = new Map<string, AgentTraceStep[]>();
    for (const row of stepRows) {
      const steps = stepsByRun.get(row.runId) ?? [];
      steps.push(toTraceStep(row));
      stepsByRun.set(row.runId, steps);
    }

    return runs.map((row) => ({
      run: toAgentRun(row),
      steps: stepsByRun.get(row.id) ?? [],
    }));
  }

  /** Recent runs across every case, newest first. Powers the trace index page. */

  /** Recent runs across every case, newest first. Powers the trace index page. */
  async getRecentRuns(limit: number): Promise<AgentRunSummary[]> {
    const runs = await this.db
      .select()
      .from(agentRuns)
      .orderBy(desc(agentRuns.createdAt))
      .limit(limit);
    if (runs.length === 0) return [];

    const caseIds = [...new Set(runs.map((run) => run.auditCaseId))];
    const caseRows = await this.db
      .select({
        id: auditCases.id,
        status: auditCases.status,
        firstBlock: sql<string | null>`${auditSnapshots.document}->'blocks'->0->>'text'`,
        parties: auditSnapshots.parties,
      })
      .from(auditCases)
      .leftJoin(
        auditSnapshots,
        and(
          eq(auditSnapshots.auditCaseId, auditCases.id),
          eq(
            auditSnapshots.createdAt,
            sql`(SELECT MAX(s2.created_at) FROM ${auditSnapshots} s2 WHERE s2.audit_case_id = ${auditCases.id})`,
          ),
        ),
      )
      .where(inArray(auditCases.id, caseIds));
    const caseById = new Map(caseRows.map((row) => [row.id, row]));

    const countRows = await this.db
      .select({ runId: agentTraceSteps.runId, stepCount: count() })
      .from(agentTraceSteps)
      .where(
        inArray(
          agentTraceSteps.runId,
          runs.map((run) => run.id),
        ),
      )
      .groupBy(agentTraceSteps.runId);
    const countByRun = new Map(countRows.map((row) => [row.runId, Number(row.stepCount)]));

    return runs.map((row) => {
      const auditCase = caseById.get(row.auditCaseId);
      return {
        ...toAgentRun(row),
        contractTitle: contractTitleFromFirstBlock(auditCase?.firstBlock),
        parties: (auditCase?.parties ?? []) as ContractParty[],
        caseStatus: (auditCase?.status ?? "PENDING") as AuditCaseStatus,
        stepCount: countByRun.get(row.id) ?? 0,
      };
    });
  }
}
