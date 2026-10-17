import { createHash } from "node:crypto";
import { findDemoContract } from "@contract-audit/audit/demo-contracts";
import type { AuditCaseStatus, SourceProvenance } from "@contract-audit/audit/model";
import { evaluateSubjectRiskRule } from "@contract-audit/audit/subject-rule";
import { Elysia, t } from "elysia";
import { buildAuditReportDocx } from "../audit/audit-report";
import { type AuditCaseRepository, contractTitleFromFirstBlock } from "../db/repositories";
import type { RuleRepository } from "../db/rule-repository";
import type { AuditDispatcher } from "../dispatcher";
import { validateMimeType } from "../document";
import {
  describeStorageError,
  originalStorageOf,
  readOriginal,
  removeOriginal,
  saveOriginal,
} from "../document/original-store";
import { errorSchema, notFoundSchema, openapiTags } from "../openapi";
import { type AuditEventBroker, sseResponse } from "../sse";

export interface AuditRouteDeps {
  repository: AuditCaseRepository;
  dispatcher: AuditDispatcher;
  broker: AuditEventBroker;
  /** Published Rule Versions the snapshot's parameters are read from. */
  rules: RuleRepository;
}

export interface AuditCasesRouteDeps extends AuditRouteDeps {
  /** Largest accepted upload, in bytes; anything larger is refused with 413. */
  maxUploadBytes: number;
}

const createBody = t.Object({
  source: t.Literal("text"),
  contractText: t.String(),
  policyLimitRatio: t.Optional(t.Number()),
  /** Built-in sample the textarea still holds verbatim, when one was loaded. */
  demoId: t.Optional(t.String()),
  /** When set, registers this audit as the next revision of an existing Contract. */
  contractId: t.Optional(t.String()),
});

const AUDIT_CASE_TAGS = [openapiTags.auditCases];

const auditCaseStatusSchema = t.Union([
  t.Literal("PENDING"),
  t.Literal("RUNNING"),
  t.Literal("AWAITING_REVIEW"),
  t.Literal("COMPLETED"),
  t.Literal("FAILED"),
  t.Literal("CANCELLED"),
  t.Literal("INTERRUPTED"),
]);

const auditStageSchema = t.Union([
  t.Literal("QUEUED"),
  t.Literal("NORMALIZING"),
  t.Literal("RULE_ASSESSMENT"),
  t.Literal("SUBJECT_VERIFICATION"),
  t.Literal("AGENT_RUNNING"),
  t.Literal("AWAITING_REVIEW"),
  t.Literal("COMPLETED"),
  t.Literal("FAILED"),
  t.Literal("CANCELLED"),
  t.Literal("INTERRUPTED"),
]);

/**
 * A case identity as the audit queue and detail views carry it.
 */
const auditCaseSchema = t.Object(
  {
    id: t.String(),
    status: auditCaseStatusSchema,
    stage: auditStageSchema,
    sourceRecordId: t.String(),
    createdAt: t.String(),
    updatedAt: t.String(),
  },
  { additionalProperties: true, description: "审计案件本身。" },
);

/**
 * The 202 body a create/retry/reassess responds with: the case is queued, not
 * yet audited. `additionalProperties` stays open, so the schema documents the
 * shape without ever rejecting a body the handler legitimately returns.
 */
const queuedCaseSchema = t.Object(
  {
    id: t.String({ description: "审计案件 id" }),
    status: t.Literal("PENDING", { description: "入队后的状态，固定为 PENDING" }),
  },
  { additionalProperties: true, description: "案件已入队，等待 Agent 运行。" },
);

/** A queue row: case identity plus the summary the 审计队列 renders. */
const caseSummarySchema = t.Object(
  {
    id: t.String(),
    status: auditCaseStatusSchema,
    stage: auditStageSchema,
    sourceRecordId: t.String(),
    contractRevisionId: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
    updatedAt: t.String(),
    contractTitle: t.Union([t.String(), t.Null()]),
    findingCount: t.Number({ description: "链头发现数；被替代的修订不计入" }),
    highestSeverity: t.Union([t.Literal("LOW"), t.Literal("MEDIUM"), t.Literal("HIGH"), t.Null()], {
      description: "最高严重度；无发现时为 null",
    }),
    subjectRedLineCount: t.Number(),
    sourceProvenance: t.Union([
      t.Object({
        type: t.Union([t.Literal("TEXT_PASTE"), t.Literal("FILE_UPLOAD"), t.Literal("DEMO")]),
        displayName: t.Union([t.String(), t.Null()]),
      }),
      t.Null(),
    ]),
    originalStorage: t.Union([t.Literal("s3"), t.Literal("local"), t.Null()], {
      description: "s3 / local；无原件时为 null",
    }),
  },
  { additionalProperties: true, description: "审计案件列表行。" },
);

/**
 * A case can only be reassessed once it has stopped: a running or completed
 * case has no new work to schedule, and reassessing a case awaiting review
 * would discard the human decisions already recorded against it.
 */
const REASSESSABLE_STATUSES: Record<AuditCaseStatus, boolean> = {
  PENDING: false,
  RUNNING: false,
  AWAITING_REVIEW: false,
  COMPLETED: false,
  FAILED: true,
  CANCELLED: true,
  INTERRUPTED: true,
};

/**
 * A case may only be retried while it has not yet reached human review.
 * Retrying reuses the case, so a case whose findings were already reviewed
 * would have a new agent run append its proposals into reviewed work. Those
 * cases are re-run instead, which opens a new case.
 */
const RETRYABLE_STATUSES: Record<AuditCaseStatus, boolean> = {
  PENDING: false,
  RUNNING: false,
  AWAITING_REVIEW: false,
  COMPLETED: false,
  FAILED: true,
  CANCELLED: true,
  INTERRUPTED: true,
};

/**
 * Provenance of a pasted submission. The catalog decides what counts as a
 * built-in sample, and the text must still match it: once an operator edits a
 * loaded sample the submission is an ordinary paste again, and recording it as
 * DEMO would be a lie about where the contract came from.
 */
export function resolvePasteProvenance(body: {
  contractText: string;
  demoId?: string;
}): SourceProvenance {
  const demo = body.demoId === undefined ? undefined : findDemoContract(body.demoId);
  if (demo === undefined || demo.text.trim() !== body.contractText.trim()) {
    return { type: "TEXT_PASTE", displayName: null };
  }
  return { type: "DEMO", displayName: demo.title };
}

/** The declared MIME type of the multipart part carrying the uploaded file. */
const FILE_PART_MIME = /filename="[^"]*"[^\r\n]*\r\n(?:[^\r\n]+\r\n)*?Content-Type:\s*([^\r\n;]+)/i;

/**
 * Reads the MIME type the client declared for the uploaded file's part. The
 * multipart parser rewrites a File's `type` from its filename extension, so
 * `file.type` cannot tell a real PDF from any file merely named `.pdf`;
 * validating the upload contract requires the header as sent on the wire.
 * Only part headers are read — never the payload — so this stays cheap even
 * for a rejected oversized upload.
 */
async function readDeclaredFileMime(request: Request): Promise<string> {
  const reader = request.clone().body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  // Part headers always precede the file content and are tiny; the cap is a
  // guard against a body that never terminates.
  const maxHeaderBytes = 16_384;
  let text = "";
  try {
    while (text.length < maxHeaderBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (FILE_PART_MIME.test(text)) break;
    }
  } catch {
    return "";
  } finally {
    // A cloned stream's cancellation waits for the original branch to finish.
    // Let multipart parsing consume that branch instead of blocking it here.
    void reader.cancel().catch(() => {});
  }
  return FILE_PART_MIME.exec(text)?.[1]?.trim() ?? "";
}

export function auditCasesRoutes({
  repository,
  dispatcher,
  broker,
  rules,
  maxUploadBytes,
}: AuditCasesRouteDeps) {
  /** Wire-declared part MIME per in-flight upload, captured before parsing. */
  const declaredUploadMime = new WeakMap<Request, string>();
  const wakeQueuedCase = (auditCaseId: string) => {
    void dispatcher.enqueue(auditCaseId).catch(() => {
      console.warn("AUDIT_QUEUE_WAKEUP_FAILED", { auditCaseId });
    });
  };
  return (
    new Elysia()
      .post(
        "/api/audit-cases",
        async ({ body, set }) => {
          const sourceRecordId = crypto.randomUUID();
          const { caseId } = await repository.createQueuedCase(
            sourceRecordId,
            body.contractText,
            resolvePasteProvenance(body),
            {
              metadata:
                body.policyLimitRatio === undefined
                  ? undefined
                  : { policyLimitRatio: body.policyLimitRatio },
              contractId: body.contractId ?? null,
            },
          );
          wakeQueuedCase(caseId);
          set.status = 202;
          return { id: caseId, status: "PENDING" as const };
        },
        {
          body: createBody,
          detail: {
            summary: "粘贴合同文本发起审计",
            description:
              "以粘贴的合同文本创建一个审计案件。服务端把文本规范化为 Contract Document IR，读取当前已发布的规则版本组装审计快照，写入一条不可变的 Source Record，" +
              "再把案件入队等待 Agent 运行。\n\n" +
              "- 幂等性：**非幂等**，每次调用都会新建一个案件与 Source Record。\n" +
              "- `demoId` 只在文本与内置样例仍逐字一致时才记录为 DEMO 来源，否则按普通粘贴处理。\n" +
              "- `policyLimitRatio` 是该次审计的付款比例上限覆盖值（0–1），优先于已发布规则中的默认值。\n" +
              "- 副作用：案件入队后由调度器异步运行，进度通过案件事件流（SSE）推送。\n\n" +
              "状态码：`202` 表示已受理并入队（返回 `PENDING`）；`422` 表示请求体不符合 schema。",
            tags: AUDIT_CASE_TAGS,
          },
          response: { 202: queuedCaseSchema, 422: errorSchema },
        },
      )
      // File upload: accepts multipart/form-data with a single dossier file
      // (.docx, .pdf, .xlsx, .txt). The file is parsed into the same Contract
      // Document IR the text endpoint produces, so everything downstream —
      // rules, party extraction, the agent — is format-agnostic.
      .onRequest(async ({ request }) => {
        if (request.method !== "POST" || !request.url.endsWith("/api/audit-cases/upload")) return;
        const declared = await readDeclaredFileMime(request);
        if (declared !== "") declaredUploadMime.set(request, declared);
      })
      .post(
        "/api/audit-cases/upload",
        async ({ body, request, set }) => {
          // Size and type are checked before any parsing work is attempted: an
          // oversized body is refused outright, and a file whose declared type
          // does not match its extension never reaches the format parser.
          if (body.file.size > maxUploadBytes) {
            set.status = 413;
            return { error: "file_too_large" };
          }
          // `file.type` is derived from the filename by the multipart parser,
          // so the wire-declared type is what the contract is checked against;
          // it falls back to the parser's value when no header was present.
          const mimeError = validateMimeType(
            body.file.name,
            declaredUploadMime.get(request) ?? body.file.type,
          );
          if (mimeError !== true) {
            set.status = 422;
            return { error: mimeError };
          }
          const sourceRecordId = crypto.randomUUID();
          const fileBytes = Buffer.from(await body.file.arrayBuffer());
          const rawLimit = Number(body.policyLimitRatio);
          const policyLimit =
            body.policyLimitRatio === undefined || Number.isNaN(rawLimit)
              ? undefined
              : rawLimit > 1
                ? rawLimit / 100
                : rawLimit;
          // The original bytes are persisted BEFORE the case is registered, and
          // the locator travels inside the same transaction that writes the
          // source record, the contract revision and the case. So a database
          // failure after the Put can never leave a PENDING case whose
          // original is unreachable — the only recovery needed is the object
          // this route already owns, which is removed explicitly below.
          const originalPath = await saveOriginal(sourceRecordId, fileBytes, body.file.name);
          let caseId: string;
          try {
            const queuedCaseOptions = {
              originalPath,
              metadata: {
                uploadFileName: body.file.name,
                originalSha256: createHash("sha256").update(fileBytes).digest("hex"),
                originalSizeBytes: fileBytes.length,
                originalMimeType: declaredUploadMime.get(request) ?? "application/octet-stream",
                originalBackend: originalStorageOf(originalPath),
                ...(policyLimit === undefined ? {} : { policyLimitRatio: policyLimit }),
              },
            };
            const created = await repository.createQueuedCase(
              sourceRecordId,
              "",
              { type: "FILE_UPLOAD", displayName: body.file.name },
              queuedCaseOptions,
            );
            caseId = created.caseId;
          } catch (error) {
            // Registration failed, so no case and no source row exist. The
            // bytes this route just wrote are unreferenced garbage; deleting
            // the exact locator the store returned keeps the bucket free of
            // orphans without touching anything else. A cleanup failure is
            // reported, never swallowed: the operator must know one object may
            // need manual removal, and the request still fails.
            const removed = await removeOriginal(originalPath);
            if (!removed) {
              console.error("ORIGINAL_ORPHAN_CLEANUP_FAILED", { sourceRecordId });
            }
            throw error;
          }
          wakeQueuedCase(caseId);
          set.status = 202;
          return { id: caseId, status: "PENDING" as const };
        },
        {
          body: t.Object({
            file: t.File({ description: "卷宗文件（.docx / .pdf / .xlsx / .txt）" }),
            policyLimitRatio: t.Optional(
              t.String({ description: '付款比例上限；0–1 为比例，>1 视为百分数（"30" → 0.3）' }),
            ),
          }),
          detail: {
            summary: "上传合同文件发起审计",
            description:
              "以 `multipart/form-data` 上传单个卷宗文件（.docx / .pdf / .xlsx / .txt）创建审计案件。文件被解析为与文本入口相同的 Contract Document IR，" +
              "因此下游的规则、主体抽取与 Agent 都与格式无关。\n\n" +
              "- 解析在入队后异步进行：无文本层的扫描件 PDF 走 OCR 识别，OCR 未配置或识别不出内容时该案件失败并记录原因，而非当作空文件。\n" +
              "- `.xlsx` 额外保留单元格地址、公式与数字格式，供跨文档金额核对引用。\n" +
              "- 大小上限由 `MAX_UPLOAD_BYTES` 控制，超过即返回 `413`，**在任何解析之前**拒绝。\n" +
              "- 类型校验以线上声明的 part MIME 为准（解析器会按扩展名改写 `file.type`，不可信），扩展名与声明类型不符返回 `422`。\n" +
              "- 保存顺序：先落原件字节，再在**同一个事务**里写入 Source Record、合同修订与案件（原件定位随事务一起登记），" +
              "因此失败不会留下“案件已入队但原件缺失”的状态；登记失败时只会清理本次上传产生的那一个对象。\n" +
              "`S3_STRICT` 为真（demo/production 默认）时对象存储写入失败即本次上传失败，不会悄悄改写到本地目录。\n" +
              "- 副作用：写入 Source Record、保存原件（对象存储或本地）、入队并异步运行；`202` 只表示已受理。\n" +
              "- 幂等性：**非幂等**，重复上传会生成新的案件与原件。\n\n" +
              "状态码：`202` 已受理；`413` 文件过大；`422` 类型不被支持或文件内容为空；`500` 原件保存失败。",
            tags: AUDIT_CASE_TAGS,
          },
          response: {
            202: queuedCaseSchema,
            413: errorSchema,
            422: errorSchema,
            500: errorSchema,
          },
        },
      )
      // Download the uploaded original for a Source Record. Pasted submissions
      // have no file, so they answer 404 rather than fabricate one.
      .get(
        "/api/source-records/:id/original",
        async ({ params, set }) => {
          const record = await repository.getSourceRecord(params.id);
          if (!record?.originalPath) {
            set.status = 404;
            return { error: "no_original" };
          }
          let buffer: Buffer;
          try {
            buffer = await readOriginal(record.originalPath, record.metadata);
          } catch (error) {
            const code = describeStorageError(error);
            set.status =
              code === "original_missing"
                ? 404
                : code === "original_integrity_mismatch"
                  ? 409
                  : code === "access_denied" ||
                      code === "original_bucket_not_allowed" ||
                      code === "original_path_outside_upload_dir"
                    ? 403
                    : 503;
            return { error: code };
          }
          const filename = record.name ?? "contract";
          // RFC 6266: a byte-safe fallback plus a UTF-8 form, so non-ASCII
          // upload names survive the round trip without an invalid header value.
          const asciiName = filename.replace(/[^\x20-\x7e]|["\\]/gu, "_");
          const disposition =
            `attachment; filename="${asciiName}"; ` +
            `filename*=UTF-8''${encodeURIComponent(filename)}`;
          return new Response(new Uint8Array(buffer), {
            headers: {
              "content-disposition": disposition,
              "content-type": "application/octet-stream",
            },
          });
        },
        {
          params: t.Object({ id: t.String({ description: "Source Record id" }) }),
          detail: {
            summary: "下载合同原件",
            description:
              "下载某条 Source Record 保存的合同原件（上传时的原始文件）。响应不是 JSON：成功时返回 `application/octet-stream`，" +
              "并带 RFC 6266 的 `Content-Disposition`（ASCII 回退名 + UTF-8 文件名）。\n\n" +
              "- 粘贴文本提交的案件没有原件，返回 `404`；原件在存储中丢失也返回 `404`，不会伪造文件。\n" +
              "- 只读，可重复调用。",
            tags: AUDIT_CASE_TAGS,
          },
          response: { 403: errorSchema, 404: notFoundSchema, 409: errorSchema, 503: errorSchema },
        },
      )
      .get("/api/audit-cases", async () => repository.getCasesWithContractTitle(), {
        detail: {
          summary: "列出审计案件",
          description:
            "返回审计队列：每个案件连同合同标题、链头发现数、最高严重度、主体红线计数与原件来源。\n\n" +
            "按更新时间倒序（最新在前）。只读，无查询参数；需要按状态筛选时由前端在结果上过滤。",
          tags: AUDIT_CASE_TAGS,
        },
        response: { 200: t.Array(caseSummarySchema) },
      })
      .get(
        "/api/audit-cases/:id/report.docx",
        async ({ params, set }) => {
          const auditCase = await repository.getCase(params.id);
          if (!auditCase) {
            set.status = 404;
            return { error: "Audit case not found" };
          }
          const snapshot = await repository.getSnapshotByCase(params.id);
          const findings = await repository.getFindingsByCase(params.id);
          const remediations = await repository.getRemediationsForCase(params.id);
          const title =
            contractTitleFromFirstBlock(snapshot?.contractDocument.blocks[0]?.text) ?? "未命名合同";
          const contractId = await repository.contractIdForCase(params.id);
          const revisionDiffs =
            contractId === null ? [] : ((await repository.getContract(contractId))?.diffs ?? []);
          const buffer = await buildAuditReportDocx({
            caseId: params.id,
            contractTitle: title,
            status: auditCase.status,
            snapshot,
            findings,
            remediations: remediations.map((item) => ({
              summary: item.summary,
              severity: item.severity,
              status: item.status,
              owner: item.owner,
              closureHint: item.closureHint,
            })),
            revisionDiffs,
          });
          return new Response(new Uint8Array(buffer), {
            headers: {
              "content-type":
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "content-disposition": 'attachment; filename="audit-report.docx"',
            },
          });
        },
        {
          params: t.Object({ id: t.String() }),
          detail: {
            summary: "导出审查报告（docx）",
            description: "生成包含规则覆盖面、发现、证据原文与复核结论的 Word 报告。",
            tags: AUDIT_CASE_TAGS,
          },
          response: { 404: notFoundSchema },
        },
      )
      .get(
        "/api/audit-cases/:id",
        async ({ params, set }) => {
          const auditCase = await repository.getCase(params.id);
          if (!auditCase) {
            set.status = 404;
            return { error: "Audit case not found" };
          }
          const snapshot = await repository.getSnapshotByCase(params.id);
          const findings = await repository.getFindingsByCase(params.id);
          const sourceRecord = await repository.getSourceRecord(auditCase.sourceRecordId);
          if (!snapshot) {
            return {
              case: auditCase,
              snapshot: null,
              evidence: [],
              ruleAssessments: [],
              subjectVerifications: [],
              partyHistory: [],
              findings,
              sourceProvenance: sourceRecord?.provenance ?? null,
              originalDownloadable: Boolean(sourceRecord?.originalPath),
              originalStorage: originalStorageOf(sourceRecord?.originalPath),
            };
          }

          const { verifications, evidence: subjectEvidence } = await repository.getSubjectDimension(
            params.id,
          );
          // SUBJECT_RED_LINE_RISK is a special rule: its assessment depends on
          // external verification, not published parameters, so the version may
          // be null even when the rule is active. Gate on the runtime enabled
          // state, not on published-versions presence.
          // state. When no rule row exists (unseeded/test), default to enabled.
          const allRules = await rules.listRules();
          const subjectRule = allRules.find((r) => r.code === "SUBJECT_RED_LINE_RISK");
          const subjectEnabled = subjectRule ? subjectRule.enabled !== false : true;
          const subjectVersion =
            (await rules.getPublishedVersions(["SUBJECT_RED_LINE_RISK"])).get(
              "SUBJECT_RED_LINE_RISK",
            )?.version ?? null;
          const analyses = subjectEnabled
            ? [
                ...snapshot.ruleAssessments,
                {
                  ...evaluateSubjectRiskRule({ parties: snapshot.parties, verifications }),
                  ruleVersion: subjectVersion,
                },
              ]
            : snapshot.ruleAssessments;

          const history = await repository.getPartyHistory(params.id);
          const historyRule = allRules.find((rule) => rule.code === "PARTY_HISTORY_ASSOCIATION");
          const historyEnabled = historyRule ? historyRule.enabled !== false : true;
          const historyVersion =
            (await rules.getPublishedVersions(["PARTY_HISTORY_ASSOCIATION"])).get(
              "PARTY_HISTORY_ASSOCIATION",
            )?.version ?? null;
          const withHistory =
            historyEnabled && history
              ? [
                  ...analyses,
                  {
                    ...history.assessment,
                    ruleVersion: historyVersion,
                  },
                ]
              : analyses;

          return {
            case: auditCase,
            snapshot: {
              facts: snapshot.facts,
              parties: snapshot.parties,
              document: snapshot.contractDocument,
            },
            evidence: [
              ...snapshot.evidence,
              ...subjectEvidence,
              ...(historyEnabled ? (history?.evidence ?? []) : []),
            ],
            ruleAssessments: withHistory,
            subjectVerifications: verifications,
            partyHistory: historyEnabled ? (history?.hits ?? []) : [],
            findings,
            sourceProvenance: sourceRecord?.provenance ?? null,
            originalDownloadable: Boolean(sourceRecord?.originalPath),
            originalStorage: originalStorageOf(sourceRecord?.originalPath),
          };
        },
        {
          params: t.Object({ id: t.String({ description: "审计案件 id" }) }),
          detail: {
            summary: "获取审计案件详情",
            description:
              "返回一个案件的完整视图：案件本身、当前快照的事实/主体/文档、证据、规则评估、主体核验与主体历史、链头发现、来源与原件可下载性。\n\n" +
              "- 主体红线风险（SUBJECT_RED_LINE_RISK）与主体历史关联（PARTY_HISTORY_ASSOCIATION）会按运行时的规则启停状态动态并入评估列表；" +
              "被停用的规则不会出现在结果里。\n" +
              "- 快照可能有多份（重评估后追加）；此接口总是返回最新一份，旧快照保持可读。\n\n" +
              "状态码：`200` 正常；`404` 案件或快照不存在。\n\n" +
              "响应体字段：`case`、`snapshot`（`facts`/`parties`/`document`）、`evidence`、`ruleAssessments`、`subjectVerifications`、`partyHistory`、`findings`、`sourceProvenance`、`originalDownloadable`、`originalStorage`。",
            tags: AUDIT_CASE_TAGS,
          },
          response: { 404: notFoundSchema },
        },
      )
      .get(
        "/api/audit-cases/:id/events",
        ({ params, request }) =>
          sseResponse(broker, params.id, () => repository.getCase(params.id), request.signal),
        {
          params: t.Object({ id: t.String({ description: "审计案件 id" }) }),
          detail: {
            summary: "订阅审计案件事件流（SSE）",
            description:
              "**Server-Sent Events 流**，不是普通 JSON：`Content-Type: text/event-stream`，每个事件是一行 `data: <json>`。\n\n" +
              '- 连接建立后先推送一帧 `{ type: "snapshot", auditCaseId, snapshot }`，让订阅者立刻拿到当前状态。\n' +
              "- 之后按发生顺序推送案件事件（如 `audit.completed`、`remediation.created`、`remediation.transitioned`、`remediation.closed`、`review.assigned`）。\n" +
              "- 保持连接直到客户端断开；无事件时不写心跳。该端点不返回 JSON 错误体，订阅一个不存在的案件只会得到一帧 `snapshot` 为 null 的初始帧。",
            tags: AUDIT_CASE_TAGS,
          },
        },
      )
      .post(
        "/api/audit-cases/:id/cancel",
        async ({ params }) => {
          await dispatcher.cancel(params.id);
          return { id: params.id, status: "CANCELLED" as const };
        },
        {
          params: t.Object({ id: t.String({ description: "审计案件 id" }) }),
          detail: {
            summary: "取消审计案件",
            description:
              "取消一个案件。运行中的案件会被中止；尚未被领取的 PENDING 案件会被直接置为 CANCELLED，" +
              "从而不会被其它副本领取。\n\n" +
              "- 幂等性：**幂等**——案件不存在或已不在运行/待运行状态时不报错，仍返回 `CANCELLED`。\n" +
              "- 副作用：向案件事件流推送 `audit.cancelled`。\n\n" +
              "状态码：`200` 已取消（或本就无需取消）；`422` 路径参数不合法。",
            tags: AUDIT_CASE_TAGS,
          },
          response: {
            200: t.Object(
              {
                id: t.String(),
                status: t.Literal("CANCELLED", { description: "固定为 CANCELLED" }),
              },
              { additionalProperties: true },
            ),
            422: errorSchema,
          },
        },
      )
      .post(
        "/api/audit-cases/:id/retry",
        async ({ params, set }) => {
          // An explicit guard rather than trusting the dispatcher's requeue:
          // retrying reuses this case, so allowing it on a case a human has
          // already reviewed would let a fresh agent run append new findings
          // into reviewed work. A stopped-but-unreviewed failure may be
          // retried; an audited case must be re-run as a new case instead.
          const existing = await repository.getCase(params.id);
          if (!existing) {
            set.status = 404;
            return { error: "audit_case_not_found" };
          }
          if (!RETRYABLE_STATUSES[existing.status]) {
            set.status = 409;
            return { error: "case_not_retryable" };
          }
          await dispatcher.retry(params.id);
          set.status = 202;
          return { id: params.id, status: "PENDING" as const };
        },
        {
          params: t.Object({ id: t.String({ description: "审计案件 id" }) }),
          detail: {
            summary: "重试审计案件",
            description:
              "重新运行 Agent：把一个失败、取消或中断的案件重新入队，沿用**当前已有**的快照（不重建规则参数）。\n\n" +
              "- 与重评估的区别：重试沿用旧快照，重评估会用最新已发布规则重建快照。\n" +
              "- 只适用于尚未进入人工复核的案件。已完成或待复核的案件必须改用「重新审计」，让新发现进入一个新案件，而不是追加进已复核的旧案件。\n" +
              "- 仍在排队或审计中的案件返回 `409`。\n\n" +
              "状态码：`202` 已重新入队；`404` 案件不存在；`409` 案件当前不可重试；`422` 路径参数不合法。",
            tags: AUDIT_CASE_TAGS,
          },
          response: {
            202: queuedCaseSchema,
            404: notFoundSchema,
            409: errorSchema,
            422: errorSchema,
          },
        },
      )
      // A rerun re-audits a stopped case as a NEW case: same Source Record,
      // same Contract Revision, fresh snapshot and fresh Agent Run. It exists
      // because retry and reassess both reuse the case they are called on, so
      // their new findings land in the very case a human already reviewed —
      // mixing machine output into reviewed work. Rerunning instead opens a
      // clean case and leaves the old one immutable.
      .post(
        "/api/audit-cases/:id/rerun",
        async ({ params, set }) => {
          const result = await repository.createRerunCase(params.id);
          if (result.status === "not_found") {
            set.status = 404;
            return { error: "audit_case_not_found" };
          }
          if (result.status === "case_active") {
            set.status = 409;
            return { error: "case_active" };
          }
          if (result.status === "rerun_active") {
            set.status = 409;
            return { error: "rerun_already_active" };
          }
          wakeQueuedCase(result.caseId);
          set.status = 202;
          return {
            id: result.caseId,
            status: "PENDING" as const,
            sourceCaseId: result.sourceCaseId,
          };
        },
        {
          params: t.Object({ id: t.String({ description: "作为来源的审计案件 id" }) }),
          detail: {
            summary: "重新审计案件",
            description:
              "对一个已停止的案件（已完成 / 待复核 / 失败 / 取消 / 中断）发起一次**全新**审计：新建案件，" +
              "沿用同一 Source Record 与同一 Contract Revision，重新解析原件并按当前规则、当前设置组装新快照，" +
              "再跑一次 Agent。\n\n" +
              "- 原案件及其状态、快照、发现、人工复核与整改记录**完全不变**，新的发现只会写进新案件；" +
              "这就是它与「重试 / 重评估」的区别——后两者复用同一案件，新发现会落入已复核的旧案件。\n\n" +
              "- 沿用同一 Contract Revision 而不是新建版本：重新读取的是同一份字节，没有发生文档变更。\n\n" +
              "- 前置条件：案件必须已停止。仍在排队或审计中的案件返回 `409`；" +
              "同一修订上已有排队或审计中的案件时返回 `409`，避免同一版本并行审计。\n\n" +
              "- 副作用：插入新案件（PENDING/QUEUED）并入队，调度器异步运行，进度通过新案件的事件流（SSE）推送。\n\n" +
              "状态码：`202` 已受理（返回新案件 id 与来源案件 id）；`404` 案件不存在；`409` 案件仍在运行或该修订已有进行中的审计；`422` 路径参数不合法。",
            tags: AUDIT_CASE_TAGS,
          },
          response: {
            202: queuedCaseSchema,
            404: notFoundSchema,
            409: errorSchema,
            422: errorSchema,
          },
        },
      )
      // Reassessment rebuilds the snapshot from the current published Rule
      // Versions and the current enabled/disabled overlay, then requeues the
      // case. The original snapshot is left in place, so the assessments a
      // past decision rested on remain readable.
      .post(
        "/api/audit-cases/:id/reassess",
        async ({ params, set }) => {
          const existing = await repository.getCase(params.id);
          if (!existing) {
            set.status = 404;
            return { error: "audit_case_not_found" };
          }
          if (!REASSESSABLE_STATUSES[existing.status]) {
            set.status = 409;
            return { error: "case_not_reassessable" };
          }
          const previous = await repository.getSnapshotByCase(params.id);
          if (!previous) {
            set.status = 404;
            return { error: "audit_snapshot_not_found" };
          }
          await repository.patchSourceRecordMetadata(previous.sourceRecordId, {
            pendingReassess: true,
          });
          await repository.updateCaseStatus(params.id, "PENDING", "QUEUED");
          wakeQueuedCase(params.id);
          set.status = 202;
          return { case: { ...existing, status: "PENDING" as const, stage: "QUEUED" as const } };
        },
        {
          params: t.Object({ id: t.String({ description: "审计案件 id" }) }),
          detail: {
            summary: "重评估审计案件",
            description:
              "用当前已发布的规则版本与当前启停状态**重建**快照，然后把案件重新入队。这是一次新运行，而不是恢复旧运行。\n\n" +
              "- 前置条件：案件必须已停止——仅 FAILED / CANCELLED / INTERRUPTED 可重评估；" +
              "PENDING、RUNNING、COMPLETED 会被拒绝（对等待复核的案件重评估会丢弃已记录的人工决策）。\n" +
              "- 原快照保留在案，因此过去决策所依据的评估仍然可读；新快照追加在案件上。\n" +
              "- 副作用：追加快照、状态置回 PENDING/QUEUED、入队。\n\n" +
              "状态码：`202` 已重建并入队；`404` 案件或原快照不存在；`409` 案件当前不可重评估；`422` 路径参数不合法。",
            tags: AUDIT_CASE_TAGS,
          },
          response: {
            202: t.Object(
              { case: auditCaseSchema },
              { additionalProperties: true, description: "案件已重建并入队。" },
            ),
            404: notFoundSchema,
            409: errorSchema,
            422: errorSchema,
          },
        },
      )
  );
}
