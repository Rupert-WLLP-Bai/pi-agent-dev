import { beforeEach, expect, test } from "bun:test";
import type { SubjectVerification } from "@contract-audit/audit/model";
import type { SubjectSourceRecord } from "@contract-audit/audit/subject-verification";
import { type AuditApp, createApp } from "../app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

let repository: InMemoryAuditCaseRepository;
let app: AuditApp;

beforeEach(() => {
  repository = new InMemoryAuditCaseRepository();
  app = createApp({
    repository: repository.asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
  });
});

const verification = (overrides: Partial<SubjectVerification> = {}): SubjectVerification => ({
  id: "verification-party-1",
  partyId: "party-1",
  status: "RESOLVED",
  candidates: [],
  matched: {
    name: "深圳精工科技有限公司",
    unifiedSocialCreditCode: "91440300MA5EXAMPLE",
    registrationStatus: "存续",
  },
  dimensions: [],
  providerSummary: "核查结果正常",
  evidenceIds: [],
  sourceRecordId: "record-1",
  capturedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-08T00:00:00.000Z",
  failureReason: null,
  ...overrides,
});

const sourceRecord = (id: string, subject: string): SubjectSourceRecord => ({
  id,
  provider: "qcc-fixture",
  tool: "get_company_risk_scan",
  subject,
  outcome: {
    status: "RESOLVED",
    candidates: [],
    matched: null,
    dimensions: [],
    summary: "",
    capturedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-08T00:00:00.000Z",
    failureReason: null,
  },
});

test("lists subject verifications newest capture first", async () => {
  repository.subjectVerificationRows.push(
    {
      caseId: "case-1",
      verification: verification({ id: "v-old", capturedAt: "2026-01-01T00:00:00.000Z" }),
      evidence: [],
    },
    {
      caseId: "case-2",
      verification: verification({ id: "v-new", capturedAt: "2026-02-01T00:00:00.000Z" }),
      evidence: [],
    },
  );

  const response = await app.handle(new Request("http://localhost/api/verifications"));

  expect(response.status).toBe(200);
  const body = (await response.json()) as { verifications: Array<{ id: string }> };
  expect(body.verifications.map((item) => item.id)).toEqual(["v-new", "v-old"]);
});

test("reports the provider and the matched subject name", async () => {
  repository.savedSourceRecords.set("record-1", sourceRecord("record-1", "深圳精工科技有限公司"));
  repository.subjectVerificationRows.push({
    caseId: "case-1",
    verification: verification(),
    evidence: [],
  });

  const response = await app.handle(new Request("http://localhost/api/verifications"));

  const body = (await response.json()) as {
    verifications: Array<{
      subjectName: string;
      provider: string | null;
      expiresAt: string | null;
    }>;
  };
  expect(body.verifications[0]).toMatchObject({
    subjectName: "深圳精工科技有限公司",
    provider: "qcc-fixture",
    expiresAt: "2026-01-08T00:00:00.000Z",
  });
});

test("bounds the page with the limit query", async () => {
  for (const index of [0, 1, 2]) {
    repository.subjectVerificationRows.push({
      caseId: "case-1",
      verification: verification({
        id: `v-${index}`,
        capturedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      }),
      evidence: [],
    });
  }

  const response = await app.handle(new Request("http://localhost/api/verifications?limit=2"));

  const body = (await response.json()) as { verifications: Array<{ id: string }> };
  expect(body.verifications).toHaveLength(2);
});
