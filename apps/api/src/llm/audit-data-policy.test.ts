import { describe, expect, test } from "bun:test";
import { demoContracts } from "@contract-audit/audit/demo-contracts";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { runSubjectVerification } from "@contract-audit/audit/subject-verification";
import { assertAuditDataDestination } from "./audit-data-policy";

const endpoint = "http://127.0.0.1:3425/v1";
const synthetic = createAuditSnapshot({
  sourceRecordId: crypto.randomUUID(),
  document: normalizeContractDocument(demoContracts[0].text),
});
const internal = createAuditSnapshot({
  sourceRecordId: crypto.randomUUID(),
  document: normalizeContractDocument("内部合同：向真实员工支付薪酬，银行账号为6222000000000000。"),
});

describe("audit model data destination policy", () => {
  test("allows known synthetic content without trusting caller-declared provenance", () => {
    expect(() => assertAuditDataDestination(synthetic, endpoint, "")).not.toThrow();
    const altered = structuredClone(internal);
    altered.contractDocument.hash = synthetic.contractDocument.hash;
    expect(() => assertAuditDataDestination(altered, endpoint, "")).toThrow(
      "MODEL_DATA_OUTBOUND_FORBIDDEN",
    );
  });

  test("local gateway addresses alone never authorize raw internal data", () => {
    for (const address of [endpoint, "https://models.example/v1", "http://localhost:3425/v1"]) {
      expect(() => assertAuditDataDestination(internal, address, "")).toThrow(
        "MODEL_DATA_OUTBOUND_FORBIDDEN",
      );
    }
  });

  test("an explicit processing origin authorizes only that scheme hostname and port", () => {
    expect(() =>
      assertAuditDataDestination(internal, endpoint, "http://127.0.0.1:3425"),
    ).not.toThrow();
    for (const origin of [
      "https://127.0.0.1:3425",
      "http://127.0.0.1:3426",
      "http://localhost:3425",
    ]) {
      expect(() => assertAuditDataDestination(internal, endpoint, origin)).toThrow(
        "MODEL_DATA_OUTBOUND_FORBIDDEN",
      );
    }
    expect(() =>
      assertAuditDataDestination(internal, endpoint, "http://127.0.0.1:3425/v1"),
    ).toThrow("LLM_INTERNAL_DATA_ORIGINS_INVALID");
  });

  test("a synthetic contract cannot launder real prior review data into an external request", () => {
    const snapshot = structuredClone(synthetic);
    snapshot.evidence.push({
      id: "private-history",
      sourceRecordId: "private-source",
      location: {
        kind: "PRIOR_CASE_RECORD",
        priorCaseId: "private-case",
        findingRevisionId: "private-review",
        partyName: "真实相对方",
        findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
        decision: "ACCEPTED",
        reviewerId: "真实复核人",
        reviewedAt: "2026-10-15T00:00:00Z",
        title: "真实历史合同",
      },
    });
    expect(() => assertAuditDataDestination(snapshot, endpoint, "")).toThrow(
      "MODEL_DATA_OUTBOUND_FORBIDDEN",
    );
  });

  test("real external verification stays internal even when the document is a demo sample", () => {
    const snapshot = structuredClone(synthetic);
    snapshot.evidence.push({
      id: "verification",
      sourceRecordId: "verification-source",
      location: {
        kind: "EXTERNAL_RECORD",
        provider: "qcc",
        tool: "get_company_risk_scan",
        subject: "真实主体",
        recordType: "risk",
        capturedAt: "2026-10-15T00:00:00Z",
        expiresAt: null,
      },
    });
    expect(() => assertAuditDataDestination(snapshot, endpoint, "")).toThrow(
      "MODEL_DATA_OUTBOUND_FORBIDDEN",
    );
    snapshot.evidence[snapshot.evidence.length - 1] = {
      ...snapshot.evidence[snapshot.evidence.length - 1],
      id: "fixture-verification",
      sourceRecordId: "fixture-source",
      location: {
        kind: "EXTERNAL_RECORD",
        provider: "qcc-fixture",
        tool: "get_company_risk_scan",
        subject: "合成主体",
        recordType: "risk",
        capturedAt: "2026-10-15T00:00:00Z",
        expiresAt: null,
      },
    };
    expect(() => assertAuditDataDestination(snapshot, endpoint, "")).not.toThrow();
  });

  test("a real verification failure without external locators cannot use the synthetic exemption", async () => {
    const privateDiagnostic = "SYNTHETIC_PRIVATE_UPSTREAM_DIAGNOSTIC_2281";
    const verification = await runSubjectVerification({
      parties: synthetic.parties,
      port: {
        provider: "qcc",
        tool: "get_company_risk_scan",
        verify: async () => {
          throw new Error(privateDiagnostic);
        },
      },
    });
    const context = {
      ...synthetic,
      subjectVerificationProvider: "qcc",
      evidence: [...synthetic.evidence, ...verification.evidence],
      ruleAssessments: [...synthetic.ruleAssessments, verification.ruleAssessment],
    };
    expect(() => assertAuditDataDestination(context, endpoint, "")).toThrow(
      "MODEL_DATA_OUTBOUND_FORBIDDEN",
    );
    expect(verification.ruleAssessment.basis).not.toContain(privateDiagnostic);
    const unclassified = { ...context, subjectVerificationProvider: undefined };
    expect(() => assertAuditDataDestination(unclassified, endpoint, "")).toThrow(
      "MODEL_DATA_OUTBOUND_FORBIDDEN",
    );
  });

  test.each([
    "file:///tmp/model",
    "https://user:secret@models.example/v1",
    "https://models.example/v1#target",
    "https://models.example/v1?token=secret",
  ])("rejects invalid processing destination: %s", (address) => {
    expect(() => assertAuditDataDestination(synthetic, address, "")).toThrow(
      "MODEL_DATA_DESTINATION_INVALID",
    );
  });
});
