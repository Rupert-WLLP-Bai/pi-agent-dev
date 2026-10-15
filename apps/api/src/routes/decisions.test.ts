import { describe, expect, test } from "bun:test";
import type { DecisionRequest } from "@contract-audit/audit/decision";
import { Elysia } from "elysia";
import { decisionQuestionCatalogue } from "../decision/questions";
import { decisionInputHash } from "../decision/redaction";
import { InMemoryShadowDecisionRepository } from "../decision/testing/in-memory-shadow-repository";
import { decisionsRoutes } from "./decisions";

const question = decisionQuestionCatalogue[0];
if (question === undefined || question.question.type !== "choice") {
  throw new Error("catalogue missing its first question");
}

const request: DecisionRequest = {
  schemaVersion: 1,
  auditCaseId: "00000000-0000-4000-8000-0000000000a1",
  snapshotId: "00000000-0000-4000-8000-0000000000a2",
  agentRunId: "run-a",
  contractDocumentHash: "doc-hash",
  taskType: question.taskType,
  questionKey: question.key,
  question: question.question,
  questionVersion: question.version,
  policyVersion: "p1",
  redactionVersion: "r1",
  contractStance: null,
  structuredSignals: {},
  maskedClauseExcerpt: "甲方应在合同签订后十个工作日内支付预付款。",
  evidenceRefs: [],
  ruleAssessments: [],
  comparison: null,
  dataClassification: "SYNTHETIC",
  traceId: "trace-a",
};

const app = (
  repository: InMemoryShadowDecisionRepository,
  mode: "off" | "shadow" = "shadow",
  existingCases: readonly string[] = [request.auditCaseId],
) =>
  new Elysia()
    .use(
      decisionsRoutes({
        repository,
        // The fake does not track formal audit cases; the test states which
        // ones the database would answer for.
        caseExists: async (auditCaseId) => existingCases.includes(auditCaseId),
        mode,
        provider: "fake",
      }),
    )
    .compile();

const seed = async (
  repository: InMemoryShadowDecisionRepository,
): Promise<{ decisionId: string }> => {
  const { decisionId } = await repository.ensureJob({
    auditCaseId: request.auditCaseId,
    snapshotId: request.snapshotId,
    agentRunId: request.agentRunId,
    inputHash: decisionInputHash(request),
    questionKey: question.key,
    questionVersion: question.version,
    policyVersion: request.policyVersion,
    redactionVersion: request.redactionVersion,
    provider: "fake",
    modelVersion: "fake-deterministic-v1",
    frozenInput: request,
  });
  return { decisionId };
};

describe("decision routes", () => {
  test("lists a case's advice, including when the layer is off", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    await seed(repository);
    const response = await app(repository, "off").handle(
      new Request(`http://localhost/api/audit-cases/${request.auditCaseId}/decisions`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      schemaVersion: number;
      mode: string;
      items: unknown[];
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.mode).toBe("off");
    expect(body.items).toHaveLength(1);
  });

  test("answers an unknown but well-formed case id with 404 audit_case_not_found", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const response = await app(repository).handle(
      new Request(
        "http://localhost/api/audit-cases/00000000-0000-4000-8000-0000000000ff/decisions",
      ),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      schemaVersion: number;
      error: string;
      requestId: string;
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.error).toBe("audit_case_not_found");
    expect(body.requestId).not.toBe("");
  });

  test("answers a malformed case id with 404", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const response = await app(repository).handle(
      new Request("http://localhost/api/audit-cases/not-a-uuid/decisions"),
    );
    expect(response.status).toBe(404);
  });

  test("answers a known case with no shadow advice as an empty 200 list", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const knownEmptyCase = "00000000-0000-4000-8000-0000000000aa";
    const response = await app(repository, "shadow", [knownEmptyCase]).handle(
      new Request(`http://localhost/api/audit-cases/${knownEmptyCase}/decisions`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { schemaVersion: number; items: unknown[] };
    expect(body.schemaVersion).toBe(1);
    expect(body.items).toHaveLength(0);
  });

  test("malformed case id errors carry the canonical body", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const response = await app(repository).handle(
      new Request("http://localhost/api/audit-cases/not-a-uuid/decisions"),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      schemaVersion: number;
      error: string;
      requestId: string;
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.error).toBe("audit_case_not_found");
    expect(body.requestId).not.toBe("");
  });

  test("an unexpected repository failure is a sanitized 500 with a request id", async () => {
    const failing = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(failing);
    failing.getJob = () => Promise.reject(new Error("connection refused: secret-host:5432"));
    const response = await app(failing).handle(
      new Request(`http://localhost/api/decisions/${decisionId}`),
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    // The driver's message never reaches the caller.
    expect(text).not.toContain("secret-host");
    expect(text).not.toContain("connection refused");
    const body = JSON.parse(text) as { schemaVersion: number; error: string; requestId: string };
    expect(body.schemaVersion).toBe(1);
    expect(body.error).toBe("internal_error");
    expect(body.requestId).not.toBe("");
  });

  test("an invalid Idempotency-Key is a 422, not a keyless append", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    const send = (key: string) =>
      app(repository).handle(
        new Request(`http://localhost/api/decisions/${decisionId}/feedback`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-operator": "operator-a",
            "idempotency-key": key,
          },
          body: JSON.stringify({ schemaVersion: 1, decision: "accepted" }),
        }),
      );
    const tooLong = await send("k".repeat(129));
    expect(tooLong.status).toBe(422);
    const tooLongBody = (await tooLong.json()) as { schemaVersion: number; error: string };
    expect(tooLongBody.schemaVersion).toBe(1);
    expect(tooLongBody.error).toBe("invalid_idempotency_key");

    const nonPrintable = await send("bad\u00e9key");
    expect(nonPrintable.status).toBe(422);
    expect((await nonPrintable.json()) as { error: string }).toMatchObject({
      error: "invalid_idempotency_key",
    });

    // Rejected keys never appended anything.
    expect(await repository.listFeedback(decisionId)).toHaveLength(0);

    const boundary = await send("k".repeat(128));
    expect(boundary.status).toBe(201);
    expect(await repository.listFeedback(decisionId)).toHaveLength(1);
  });

  test("returns the advice detail with its feedback", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    await repository.appendFeedback({
      decisionId,
      decision: "accepted",
      actor: "operator-a",
      reason: null,
      idempotencyKey: null,
    });
    const response = await app(repository).handle(
      new Request(`http://localhost/api/decisions/${decisionId}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      advice: { decisionId: string; calibrated: boolean; needsHumanReview: boolean };
      feedback: unknown[];
    };
    expect(body.advice.decisionId).toBe(decisionId);
    expect(body.advice.calibrated).toBe(false);
    expect(body.advice.needsHumanReview).toBe(true);
    expect(body.feedback).toHaveLength(1);
  });

  test("the detail payload never carries the frozen input", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    const response = await app(repository).handle(
      new Request(`http://localhost/api/decisions/${decisionId}`),
    );
    const text = await response.text();
    expect(text).not.toContain("frozenInput");
    expect(text).not.toContain("frozen_input");
  });

  test("answers an unknown decision with 404", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const response = await app(repository).handle(
      new Request("http://localhost/api/decisions/00000000-0000-4000-8000-0000000000fe"),
    );
    expect(response.status).toBe(404);
  });

  test("appends feedback and returns 201", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    const response = await app(repository).handle(
      new Request(`http://localhost/api/decisions/${decisionId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-operator": "%E6%88%91" },
        body: JSON.stringify({ schemaVersion: 1, decision: "rejected", reason: "分类不符" }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { decision: string; actor: string };
    expect(body.decision).toBe("rejected");
    expect(body.actor).toBe("我");
  });

  test("replays an idempotency key without appending a second event", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    const send = () =>
      app(repository).handle(
        new Request(`http://localhost/api/decisions/${decisionId}/feedback`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-operator": "operator-a",
            "idempotency-key": "key-1",
          },
          body: JSON.stringify({ schemaVersion: 1, decision: "accepted" }),
        }),
      );
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const events = await repository.listFeedback(decisionId);
    expect(events).toHaveLength(1);
  });

  test("a different body under the same key is a 409", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    await app(repository).handle(
      new Request(`http://localhost/api/decisions/${decisionId}/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-operator": "operator-a",
          "idempotency-key": "key-2",
        },
        body: JSON.stringify({ schemaVersion: 1, decision: "accepted" }),
      }),
    );
    const conflict = await app(repository).handle(
      new Request(`http://localhost/api/decisions/${decisionId}/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-operator": "operator-a",
          "idempotency-key": "key-2",
        },
        body: JSON.stringify({ schemaVersion: 1, decision: "rejected" }),
      }),
    );
    expect(conflict.status).toBe(409);
  });

  test("feedback for an unknown decision is a 404", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const response = await app(repository).handle(
      new Request("http://localhost/api/decisions/00000000-0000-4000-8000-0000000000fd/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, decision: "accepted" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  test("an over-long actor falls back to the anonymous default", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    const response = await app(repository).handle(
      new Request(`http://localhost/api/decisions/${decisionId}/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-operator": "x".repeat(200),
        },
        body: JSON.stringify({ schemaVersion: 1, decision: "accepted" }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { actor: string };
    expect(body.actor).toBe("anonymous");
  });

  test("retention dry-run reports candidates without deleting", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    const job = await repository.getJob(decisionId);
    if (job === null) throw new Error("job missing");
    job.status = "SUCCEEDED";
    job.completedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    const response = await app(repository).handle(
      new Request("http://localhost/api/decisions/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retentionDays: 30 }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      dryRun: boolean;
      candidateCount: number;
      deletedCount: number;
    };
    expect(body.dryRun).toBe(true);
    expect(body.candidateCount).toBe(1);
    expect(body.deletedCount).toBe(0);
    // Still present after a dry run.
    expect(await repository.getJob(decisionId)).not.toBeNull();
  });

  test("retention apply deletes only the terminal shadow record", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    const job = await repository.getJob(decisionId);
    if (job === null) throw new Error("job missing");
    job.status = "SUCCEEDED";
    job.completedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    const response = await app(repository).handle(
      new Request("http://localhost/api/decisions/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retentionDays: 30, apply: true }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deletedCount: number };
    expect(body.deletedCount).toBe(1);
    expect(await repository.getJob(decisionId)).toBeNull();
  });

  test("retention never touches a job with a live lease", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const { decisionId } = await seed(repository);
    const job = await repository.getJob(decisionId);
    if (job === null) throw new Error("job missing");
    job.status = "RUNNING";
    job.completedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    job.leaseExpiresAt = new Date(Date.now() + 60_000);

    const response = await app(repository).handle(
      new Request("http://localhost/api/decisions/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retentionDays: 30, apply: true }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { candidateCount: number };
    expect(body.candidateCount).toBe(0);
    expect(await repository.getJob(decisionId)).not.toBeNull();
  });
});
