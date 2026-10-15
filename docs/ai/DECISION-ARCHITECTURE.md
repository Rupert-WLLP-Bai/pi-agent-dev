# 影子决策架构（S2）

本文件描述合同智能审计系统的**独立决策层**：它如何在不影响 19 条确定性规则、Contract Stance、Pi Agent、Proposal Guard、人工复核与整改语义的前提下，提供可插拔的本地模型观察。

状态标注约定：**已实现**表示代码存在；**已实测**表示有可复现的运行证据（含命令与输出）；**未验证**表示实现存在但没有本轮实测；**未实施/阻塞**表示尚无实现或依赖不可用。本文件不把规划写成完成。

## 1. 定位与不变量

影子决策层是**辅助观察**，不是 Finding 状态的真值源。

- 19 条确定性规则、Contract Stance、Pi 受控工具、Proposal Guard、Finding 追加版本、人工复核与整改的语义**完全不变**。
- `DecisionProvider` 没有任何写入正式领域状态的接口：它只接收一个冻结请求，返回一个解析后的建议。
- 影子表、队列、Provider 或反馈故障**不能**使成功审计案件转为 FAILED，也不能改写 Snapshot / RuleAssessment / Finding / HumanReview / Remediation。
- 关闭决策层（`DECISION_MODE=off`，默认）时不创建、不领取、不调用推理；历史记录仍可读。

## 2. 组件

| 组件 | 文件 | 职责 |
| :- | :- | :- |
| 规范类型 | `packages/audit/src/decision.ts`（Main 所有） | 公共 DTO：`DecisionRequest`、`DecisionProviderResult`、`DecisionAdvice`、`DecisionFeedback`、`DecisionAdviceList`、`DecisionDetail` |
| 规范校验 | `packages/audit/src/decision-contract.ts`（Main 所有，TypeBox 1.3.27） | `validateDecisionProviderResult`：问题/答案不变量、分布完整性、类型漂移、模型自授 calibrated 字段 |
| 脱敏投影 | `apps/api/src/decision/redaction.ts` | 构造最小模型状态；输入哈希；版本常量 |
| 问题目录 | `apps/api/src/decision/questions.ts` | 服务端受控问题目录（版本化），合同文本不能改写 |
| Provider | `apps/api/src/decision/providers/` | `disabled` / `fake` / `laya-cpu` |
| 派生 | `apps/api/src/decision/derive.ts` | 从已证明成功的运行派生冻结观测；数据分级判定 |
| 持久化 | `apps/api/src/decision/shadow-repository.ts` | `shadow_jobs` / `shadow_feedback` 的读写、租约、幂等、保留期清理 |
| Worker | `apps/api/src/decision/shadow-worker.ts` | 独立扫描/领取/重试/租约恢复；唯一调用 Provider 的组件 |
| 路由 | `apps/api/src/routes/decisions.ts` | 只读详情/列表、追加反馈、保留期预演/执行 |
| 配置 | `apps/api/src/decision/config.ts` | `DECISION_*` 环境变量解析与边界 |

## 3. 数据流

```
正式审计（不变）
  dispatcher.runAudit
    ├─ ensureRunSnapshot（持久化快照）
    ├─ 规则评估 / 主体核验 / 历史关联
    ├─ agent.run（Pi 或 Fake）
    ├─ finishAgentRun
    ├─ updateCaseStatus(COMPLETED | AWAITING_REVIEW)   ← 正式终态先落库
    └─ deriveShadowAdvice(...)                          ← 仅在终态之后，且全程 try/catch

影子（独立）
  deriveShadowJob → shadow_jobs(PENDING, 冻结最小脱敏输入 + 幂等身份)
  ShadowDecisionWorker（独立进程/循环，独立并发预算）
    ├─ claimJobs（SKIP LOCKED + 租约）
    ├─ provider.decide(request, signal)   ← 唯一模型 HTTP 调用点
    ├─ completeJob / requeueJob / failJob
    └─ 独立扫描补偿：租约过期的任务由下一次扫描恢复
```

关键点：**正式 dispatcher 不 await 模型 HTTP**。`deriveShadowAdvice` 只写一行影子任务（可能失败，失败被吞掉），推理发生在 worker。因此模型离线、超时、返回非法 schema 时，正式审计结论保持权威。

## 4. 幂等身份

`shadow_jobs` 的唯一索引（全部非空，不存在可空复合唯一造成重复）：

```
(agent_run_id, question_key, question_version, policy_version,
 redaction_version, input_hash, provider, model_version)
```

- `input_hash` 覆盖文档哈希、任务类型、问题与版本、策略/脱敏版本、结构化信号、脱敏片段与数据分级；**不含** run 身份与 traceId，因此进程重启后重新派生得到同一哈希，而不是第二条任务。
- 缺少可证明身份的运行**不派生**：没有持久化快照行 id、没有成功终态、或旧版本未冻结输入的运行一律跳过。

## 5. 生命周期、租约与恢复

状态：`PENDING → RUNNING → SUCCEEDED | FAILED | SKIPPED`。

- 领取：`status='PENDING'` 或 `status='RUNNING' AND lease_expires_at < now()`，按 `created_at` 升序，`FOR UPDATE SKIP LOCKED`，一次 `LIMIT` 到并发预算。
- 有界并发：`DECISION_CONCURRENCY`（默认 1，上限 8）。本地 CPU 服务是稀缺资源。
- 超时：`DECISION_TIMEOUT_MS`（默认 10000）以 `AbortController` 取消请求。
- 重试：仅 `provider_timeout` 与 `provider_unavailable` 可重试，次数上限 `DECISION_MAX_RETRIES`（默认 2）；`invalid_request`、`invalid_response`、`forbidden_outbound`、`disabled`、`aborted` 为终态。
- 重启恢复：进程退出时 `releaseLeases(owner)` 归还本进程租约；异常退出留下的租约到期后由其他 worker 领取。重试保持同一 `decisionId`。

## 6. 失败语义

`DecisionFailure.error` 的取值与含义：

| error | 触发 | 可重试 |
| :- | :- | :- |
| `disabled` | 决策层关闭或 Provider 未配置 | 否 |
| `forbidden_outbound` | endpoint 未配置、不在允许 origin、含凭据/fragment、协议非 http(s) | 否 |
| `provider_timeout` | 本地服务超过预算 | 是 |
| `provider_unavailable` | 连接失败、429、5xx | 是 |
| `invalid_request` | 问题不满足受控目录约束 | 否 |
| `invalid_response` | 响应不符合规范（类型漂移、分布不完整、越界、NaN/Infinity） | 否 |
| `unsupported_schema` | 主版本不受支持 | 否 |
| `aborted` | 调用方取消 | 否 |

失败不伪造正常答案；公开 `fallbackReason` 只承载稳定错误码，不回显原始异常、连接串或合同片段。

## 7. 与正式链路的边界

- **不**使用 `audit_cases` 的 PENDING 队列，**不**依赖进程内 SSE 作为任务可靠性来源。
- **不**在 dispatcher 的 try 块内 await 推理；派生调用位于正式终态写入之后，并被独立 try/catch 包裹。
- 影子任务的失败只写 `shadow_jobs.status/fallback_reason`。
- 反馈（`shadow_feedback`）只追加，独立于 Finding 的人工复核历史。

## 8. 开关与回滚

- `DECISION_MODE=off|shadow`，默认 `off`。
- `DECISION_PROVIDER=disabled|fake|laya-cpu`，默认 `disabled`。
- 关闭步骤：设 `DECISION_MODE=off` 并停止 worker。正式路径不受影响；新表与历史影子记录保留，读取接口仍可呈现历史。
- 不执行破坏性 down migration。

## 9. 已知限制

- 完整置信度校准研究、高级反馈分析与多版本模型实验为**延期 P2**，本轮未实施。
- Jev 接入**已取消**；代码中不存在 Jev Provider、密钥或远程决策调用路径。
- Laya 概率**未校准**：多语 checkpoint 出厂未拟合温度；`confidence` 为熵集中度，不是正确率。
- `FakeDecisionProvider` 是明确标识的离线演示 Provider，不能冒充 Pi 或 Laya 的质量。
