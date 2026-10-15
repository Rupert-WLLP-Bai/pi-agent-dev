# 评委问答（JUDGE-FAQ）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。每个回答附**代码/文档位置或实测证据**；不确定处写"未验证/待补"，不现场编数。

## Q1. 为什么不直接让 LLM 判定合同风险？

三条理由，都是工程约束而非偏好：

1. **可追溯性**：LLM 输出无法回溯到"哪套参数、哪条证据"。本系统的每条结论可追到规则版本 + 原件码点区间（`packages/audit/src/model.ts`、ADR-0002/0003）。
2. **失败模式**：阈值类风险（预付款超限、保证金比例、付款期限）是数值判定，确定性函数可证明；模型只能补充组织证据与建议。Proposal Guard 从结构上拒绝无证据/越界提交（`proposal-guard.ts`）。
3. **责任归属**：最终判断必须是人。Finding Revision 只追加，人工确认/误报不可被模型覆盖。

公开研究亦支持这一分工：跨条款多跳推理是当前模型短板（早期调研引用区间 34–57%，见竞品矩阵 §5，保留原始限定）。

## Q2. 为什么用 RustFS 而不是 MinIO/直接本地盘？

- 合同原文需要**对象存储语义**（不可变、可寻址、可换后端）。RustFS 是 S3 兼容 API，我们只用标准 S3 SDK（`@aws-sdk/client-s3`），**不绑定私有 API**——换成任何 S3 服务只改配置（commit `1c1dc7b` 完成 MinIO→RustFS 切换，领域零改动）。
- 同时保留**本地回退**：本地开发形态下 `S3_ENDPOINT` 未配置时写 `UPLOAD_DIR`，locator 前缀记录真实后端（`docs/architecture/mvp.md` 外部服务节）。**demo/production 默认严格**：S3 写入失败即失败，不静默降级；本地回退仅在显式 `s3-fallback-local` 配置下启用。降级不是隐藏失败，health 会报告实际后端。

## Q3. 什么时候该把 PostgreSQL `SKIP LOCKED` 队列升级成独立消息队列？

触发条件明确写在 README 与架构文档：**API 需要多副本置于负载均衡之后**。当前进程内 dispatcher、内存 Session、进程内 SSE 都建立在单实例假设上；多副本时这些假设同时失效，届时才值得引入共享队列。现在引入等于为不存在的负载买基础设施。影子 worker 有独立持久化任务（租约/重试），但那也不是引入 MQ 的理由。

## Q4. 为什么不引入 RAG / Kubernetes / OpenTelemetry 全家桶？

- **RAG**：规则是确定性函数，不需要检索增强；引入向量库会把"可证明的判定"变成"相似度猜测"。对外部知识的需求以**版本化知识 manifest** 形式归档研究资料（`docs/research/2026-10-14-contract-audit-resources/`），运行时不装插件。
- **K8s**：单实例部署 + compose 一键复现是当前目标；编排复杂度会摧毁"第三方半天跑起来"的推广价值。
- **OTel**：可观测当前由 Agent Trace + health + 操作日志承担；接入全套链路追踪要先有效益场景。

每条取舍记录在 ADR/工程规格，不逐次重新辩论。

## Q5. 中文合同怎么评测？

- 规则层：黄金案例回归（`packages/audit/src/golden-eval.ts` 与发布门禁共用同一路径），覆盖正例/反例/边界（恰达阈值、分母缺失降级 `NEEDS_HUMAN_REVIEW`）。
- Agent 层：固定合成样本 + Guard 约束的结构化输出；不把 gold/comparison 送给模型；文本独立评测与带规则信号的路径分开报告。
- 数据集：早期调研已论证 CUAD 不适配（英文/美国法域/并购标注）；本轮未核到中文数据集的一手来源，**不采用未核实数字**（见竞品矩阵 §5）。
- 局限：合成参考标签尚无人类专家签核，只称"开发参考标签"（RISKS 表 RISK-09）。

## Q6. 合同隐私怎么保护？

分层回答：

1. **边界**：原始合同默认不出网；仅当 endpoint origin 精确列入 `LLM_INTERNAL_DATA_ORIGINS` 才放行，且默认空；loopback 不构成数据留域证明（`apps/api/src/llm/audit-data-policy.ts`）。
2. **最小化**：影子模型只收到最小脱敏构造，不接收身份、gold、完整请求或原始响应（契约 §5）；公开 DTO 不含原始 provider 响应。
3. **凭据**：provider/OCR key 密封存储，不随 API 返回、不进日志/浏览器；启动时校验 demo/production 加密 secret ≥32 并重封旧明文；轮换默认 dry-run（证据 `key-rotation-smoke.json`、`startup-security.json`）。
4. **访问**：单工作区口令门（Bearer/HttpOnly 会话），匿名 401 实测（`s2-security.json`）。
5. **诚实边界**：脱敏不是匿名化保证；口令门不是 RBAC/SSO；这些写进文档而非话术。

## Q7. 19 条规则怎么维护和扩展？

- **维护**：规则逻辑是确定性 TS 函数；运维改的是**参数**（阈值/立场分档），走"草稿 → 黄金案例验证 → 发布"链路；已发布版本不可变，历史快照可追溯（ADR-0003）。
- **扩展**：加一条规则 = 写函数 + 加 `RuleCode` + golden 案例 + 回归。`ENGINE_RULE_CODES` 与 `RuleCode` 联合有编译期一致性约束（`satisfies`），杜绝"列表说有、引擎没有"。
- **不做**：用户可编排的规则 DSL（安全边界与可验证性成本高于收益）。

## Q8. 怎么证明推广复制价值？

- **复现步骤**是第三方视角的：clone → `.env`（可空）→ compose → migrate → `bun run verify` → `docker compose up --build`（`docs/competition/PROJECT-BRIEF.md` §7）。fake 模式免 LLM 凭证即可全流程。
- **适配成本**分级写清（立即可用/配置后可用/需 adapter/需业务改造），不把"有页面"当"已适配"（`INNOVATIONS.md` §3）。
- **待补**：第三方实际复现记录由 Infra 在 S2/S3 归集；在此之前只称"设计为可复现"，不称"已被第三方复现"。

## Q9. 怎么防止模型幻觉进入结论？

四道闸：

1. 提案必须引用规则评估 ID 与证据 locator（Guard 校验）。
2. finding 类型/严重度受规则契约表约束；制度冲突时严重度由规则锁定。
3. 未校准/低置信必须 `needsHumanReview=true`，不进入自动路由（契约 §2）。
4. 人工复核是唯一确认路径；影子反馈独立且不影响正式状态。

## Q10. 成本/性能/模型版本怎么证实？

- 只报**有证据的样本**：真实 Pi 单合成样本 29727 ms、42 轨迹步骤、usage 20114/1832（`real-pi-smoke.json`）；本地 Laya CPU 单请求 642 ms、未校准（`laya-cpu-smoke.json`）；历史 OCR 样本 396 s（ICT 调研 §5）。
- **不报**：吞吐、并发容量、成本节省、准确率提升——没有基准就不给数字（KPI 只有定义与测量计划，见 `metrics.md`）。
- 模型版本：Pi SDK 精确锁 1.2.0；Laya 锁 code `432312b…` + 模型 revision `1720e3…`；升级记录留档（`2026-10-14-pi-1.2-upgrade.md`）。

## Q11. 这个系统能直接上生产吗？

不能直接宣称。已知边界：单实例；无 SSO/RBAC/多租户；无备份恢复演练；无多副本；影子层 S2 完成前不具备。生产门禁清单见 `docs/engineering/risk-and-release-plan.md` §1；缺口不隐藏，按 P0/P1 排序跟踪（Main 的风险表）。

## Q12. 如果大模型升级/换厂商，系统要重写吗？

不用。模型通过 OpenAI 兼容 provider 层接入（运行时可在 `/settings/providers` 增改），领域规则、Guard、证据链、UI 都不依赖具体模型。换厂商 = 改配置 + 重跑黄金回归；这正是"模型可替换、结论不依赖单一模型"的设计意图。

## Q13. 演示时网络断了怎么办？

- 演示栈的 LLM 路径可切 `AUDIT_AGENT_MODE=fake`（容器默认），流程完整可走。
- 影子路径未就绪时明确标注"预研"，不用 Fake 冒充实时推理。
- 录屏/截图一律用合成数据；断网不影响规则、复核、整改、轨迹这些本地闭环的展示。
