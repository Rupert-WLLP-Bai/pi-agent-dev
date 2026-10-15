# 隐私与治理（影子决策层，SEC4/SEC5）

本文件说明影子决策层如何处理敏感数据、保留期限与访问边界。**它不是合规认证**，也不声称满足任何标准；它记录本系统实际做了什么、以及哪些边界尚未验证。

## 1. 模型可见的数据（SEC4）

发给模型的内容由 `buildDecisionModelState` 逐字段构造，**不是** `JSON.stringify(request)`：

| 进入模型状态 | 不进入模型状态 |
| :- | :- |
| 脱敏后的条款片段 | `auditCaseId`、`snapshotId`、`agentRunId`、`traceId`、文档哈希 |
| 受控问题的 `instructions` 与选项 | `comparison`（本地基线/参考答案） |
| 扁平结构化信号（比例、计数、标志） | `ruleAssessments` 的正式规则结论与 basis 文本 |
| 数据分级标签 | 证据引用的原文坐标映射（offset/blockId） |
| | Provider 原始响应、完整提示词、任何密钥 |

理由：身份会让响应可以指认它属于哪个案件；`comparison` 会直接把模型正在被比较的答案交给它；规则结论与 basis 是正式结论，影子是独立观察，两者的比较在本地事后进行。

**脱敏**（`redactClauseExcerpt`）覆盖已提取当事人名称、统一社会信用代码/组织机构代码、银行账号、手机号与邮箱。这是**最小化**步骤，不是匿名化保证：脱敏后的文本仍是中文合同文本，并仍通过哈希与原文关联。

**原文坐标**：脱敏会改变字符串长度，因此**不**用脱敏后的下标当作原文坐标。`DecisionEvidenceReference` 中的 offset/blockId 始终指向原文文档。

## 2. 出网边界

- endpoint 来自服务端配置（`DECISION_ENDPOINT`），不在请求体、不在 URL 参数、不可由调用方指定。
- 必须出现在显式允许列表 `DECISION_ALLOWED_ORIGINS` 中；**空列表表示不允许任何 origin**。仅本机可达不构成允许。
- 拒绝含 userinfo（凭据）、fragment 的 endpoint；只接受 `http:`/`https:`。
- `redirect: "manual"`：不跟随重定向，避免把脱敏条款送到服务指定的任意地址。
- 默认**禁止**把原始合同发往外部模型；本轮明确**取消** Jev 与任何远程决策 Adapter。真实 Pi 验证由 Main 在既有配置的本地网关上用合成合同进行。

## 3. 数据分级

`classificationFor` 的判定顺序：

1. 受管 fixture（**由内容指纹证明**）→ `SYNTHETIC`；
2. 调用方显式标记的内部路径 → `INTERNAL`；
3. 其余（真实上传、粘贴、二者的重跑）→ `MASKED`。

**不接受调用方自报 SYNTHETIC**：把真实合同标成 `SYNTHETIC` 会借用内置样例豁免洗白已复核的用户数据。快照若包含 `PRIOR_CASE_RECORD` 或真实外部核验结果，不得按内置样例文本处理——这一点与 Main 的 `audit-data-policy` 一致。

## 4. 持久化与保留（SEC5）

**存了什么**：`shadow_jobs` 保存冻结的最小脱敏输入（`frozen_input`，服务恢复与哈希）、解析后的 Provider 结果（`result`）、身份/版本/租约/尝试次数/失败原因/时延。**不存**原始 Provider body、完整提示词或任何密钥。

**保留期**：`DECISION_RETENTION_DAYS`，默认 30，允许 1–365。

**清理范围**：只清理**终态**（`SUCCEEDED`/`FAILED`/`SKIPPED`）且超过保留期的影子记录及其反馈。

**从不清理**：Source Record、Audit Snapshot、Agent Run、Agent Trace、Finding、Human Review、Remediation。清理语句只寻址影子表。

**活动工作保留**：仍持有未过期租约（`RUNNING` 且 `lease_expires_at >= now()`）的记录不在候选集合内。

**入口**：`POST /api/decisions/retention`，body `{retentionDays, apply?}`。缺省 `apply` 为预演，只返回 `candidateCount`；`apply: true` 才删除并返回 `deletedCount`。两个数字都由实际查询产生，不估算。

**运行记录的辅助捕获**：正式 `agent_runs` 不保存影子输入；影子输入只存在于 `shadow_jobs.frozen_input`，随所属影子记录一起过期删除。若后续为运行增加辅助影子捕获列，其删除路径必须与本保留期一致，且**绝不**删除正式运行/轨迹/快照/发现历史。

## 5. 访问控制

影子详情/列表/反馈/保留期入口与其他 API 路径一样，受 Main 实现的统一访问门禁（`API_ACCESS_TOKEN` → Bearer 或 HttpOnly 会话）保护：健康检查与登录除外，其余（含 SSE、原件、影子详情）在启用口令时要求认证。`X-Operator` 是**归属标注，不是认证**；actor 被校验为去空白、长度 ≤128，否则回落到 `anonymous`。

## 6. 公开 DTO 边界

`DecisionDetail` / `DecisionAdviceList` / `DecisionFeedback` **不返回**：

- 冻结的最小脱敏输入；
- 完整原始 Provider 响应；
- 密钥、连接串、租约内部字段。

失败用公开 `status` + `fallbackReason`（稳定错误码）解释，不回显原始异常文本。

## 7. 尚未验证 / 边界

- 本文件描述的机制有单元测试覆盖（脱敏、出网拒绝、幂等、保留期范围），但**未**经过独立隐私审计或渗透测试。
- 脱敏是模式 + 当事人名单的启发式，可能漏掉未列举的标识形式；它是**最小化**，不是匿名化。
- 数据出境合规结论需要法务/合规评审，代码不构成合规意见。
