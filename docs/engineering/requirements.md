# 需求规格 SRS-lite（R2）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。本文是**轻量需求规格**：以可判定语句描述系统必须/应该做什么，并标注每条需求的实现与证据位置。
> **纪律**：状态分四档——`已实现且已验证`（有实跑证据）、`已实现待验证`（代码在、缺运行证据）、`实施中`（S2 进行项）、`规划`（未开始）。本文不把规划写成现状。

## 1. 范围与术语

- 产品：Contract Audit 合同智能审计系统（第一届黄桷树 AI 智能体开发大赛·智创开发赛道，独立系统形态）。
- 权威术语见仓库根 [CONTEXT.md](../../../CONTEXT.md) 与 [GLOSSARY.md](../../../GLOSSARY.md)；本文不新造同义词。
- 核心不变量（任何需求不得违反）：
  1. 确定性规则结论权威；Agent（Pi）只能提议，不能改写（Proposal Guard 强制）。
  2. Audit Snapshot 不可变；Finding Revision 只追加；人工复核/整改不可被模型覆盖。
  3. Evidence 必须引用 Source Record 与 Unicode 码点 offset（`DocumentSpanLocator`）。
  4. 影子（shadow）模型输出永远不是正式状态的真值源。

## 2. 功能需求（FR）

| ID | 需求 | 验收判据 | 状态与证据 |
| --- | --- | --- | --- |
| FR-01 | 系统必须接受合同文本（粘贴）与文件上传（`.txt`/`.md`/`.docx`/`.pdf`/`.xlsx`），规范化为 Contract Document IR | 上传入口返回 202 与案件 id；解析失败给出明确原因而非 500 | 已实现且已验证（E2E 上传用例；路由 `apps/api/src/routes/audit-cases.ts`） |
| FR-02 | 系统必须以确定性规则评估合同，规则集当前为 19 条（`ENGINE_RULE_CODES`），每条产出 `POLICY_CONFLICT`/`COMPLIANT`/`NEEDS_HUMAN_REVIEW`/`NOT_APPLICABLE` | 规则代码集合与 `packages/audit/src/model.ts` 的 `RuleCode` 一致；golden 集回归通过 | 已实现且已验证（`bun run test` golden 用例） |
| FR-03 | 系统必须支持合同立场（Contract Stance）分档：规则按 `revenue`/`procurement` 适用性过滤，不适用的规则记 `NOT_APPLICABLE` 并说明原因 | 同一合同两种立场产出不同的适用规则集 | 已实现且已验证（`contract-stance` 单测；`3e58e7b`） |
| FR-04 | 系统必须通过受控 Pi Agent 补充分析：六工具白名单（规则评估/证据/全文/搜索/块读/提交提案），禁止 shell、任意文件写、任意 HTTP | 运行协议回归断言实际工具集合与指令隔离 | 已实现且已验证（`11c5cf9` + Pi 1.2 升级记录） |
| FR-05 | 系统必须以 Proposal Guard 约束 Agent 提交：finding 类型/严重度受规则契约表限制，无证据定位的提交被拒 | Guard 拒绝路径有用例；被拒提交不产生 Finding | 已实现且已验证（`proposal-guard.test.ts`） |
| FR-06 | 系统必须提供人工复核：确认 / 误报，逐 finding 决策，生成追加式 Finding Revision | 复核决策 append-only；历史不可覆盖 | 已实现且已验证（review-center 用例） |
| FR-07 | 系统必须从已确认风险自动创建整改项，看板四态（待整改/整改中/待复核/已关闭）与关闭留痕 | 状态机迁移与 SSE 事件有用例 | 已实现且已验证（remediations 用例） |
| FR-08 | 系统必须支持规则治理：参数版本化（草稿/已发布/已退役）、发布前案例验证门禁、运行时启停 | 未通过验证不能发布；停用规则不进入新快照 | 已实现且已验证（`25322d6`、`fa345dc` 及规则用例） |
| FR-09 | 系统必须记录运行轨迹：阶段、工具调用（含参数/结果）、助手消息、token 用量，可持久化查询 | `/audit-cases/:id/trace` 渲染真实记录；旧轨迹仍可读 | 已实现且已验证（`7dd0a82`、`d9a84a4` 轨迹树） |
| FR-10 | 系统必须支持重新审计（rerun）：新案件复用同一 Source Record 与 Contract Revision，旧案全部状态原样保留 | 并发保护 `409 case_active`/`rerun_already_active`；旧案快照/发现/复核/整改不变 | 已实现且已验证（`c260e4b`；QA 修正后的验收契约） |
| FR-11 | 系统必须支持卷宗跨文档金额链核对（无状态、不落库）：xlsx/docx/pdf 混合输入的跨文档数字比对 | 端点返回一致/不符项与定位；合成卷宗实测跑通 | 已实现且已验证（`8b7a8fa`、`bf14a2b`；实测记录见 ICT 调研 §6） |
| FR-12 | 系统必须支持扫描件 OCR：provider 可配（关闭/视觉模型/MinerU），未配置时明确失败而非猜测 | OCR 设置页保存后即时生效；probe 报告真实就绪状态 | 已实现，待端到端实测证据归集（`6ef86cc`、`d9a84a4`） |
| FR-13 | 系统必须提供可观测健康端点：`/api/health` 汇总 database/dispatcher/objectStore/redis/llm/qcc，503 仅由 database/dispatcher 驱动 | 降级依赖不改变 status；目标串剥离凭据 | 已实现且已验证（S0 实测 `status=ok`） |
| FR-14 | 系统必须提供 OpenAI 兼容模型服务管理：运行时增改 provider、恰好一个"当前"、key 不随 API 返回 | 表空回退 `XYG_*`；mask 提示；空 key 编辑不抹掉已存 key | 已实现且已验证（llm-providers 用例） |
| FR-15 | 系统应提供演示世界种子：固定 RNG、场景化案件（历史关联/版本 diff/主体红线/误报对照/背靠背等） | `seed:demo` 可重复执行；场景与预期在源码中声明 | 已实现且已验证（`demo-scenarios.ts` + seed 测试） |
| FR-16 | 系统必须实现工作区访问门：`API_ACCESS_TOKEN` 启用时除 health/session 外全部 API（含 SSE、原件下载）要求 Bearer 或 HttpOnly 会话；登出/过期关闭已建立 SSE | 匿名 401、授权 200、登出 204、重放 cookie 401 | 已实现且已验证（`1f33d99` 及后续安全修复；`evidence/s2-security.json`） |
| FR-17 | 系统必须实现决策影子层（S2）：`DecisionRequest`/`DecisionAdvice`/`DecisionFeedback`，provider 为 disabled/fake/laya-cpu，默认 off | 契约测试通过；off 不创建/不领取/不推理 | 契约已冻结并验证（`6a59906`，18 测试）；实现已合并（`a6ec041`、`f7ce8d1`），待 S3 统一验收 |
| FR-18 | 系统必须实现影子反馈（S2）：append-only，`Idempotency-Key` 作用域为 decision+actor，同键同体重放返回既有事件，异体 409 | 幂等与冲突行为有测试 | 实现已合并（`a6ec041`：幂等 201/409、UUID 形状 404），待 S3 统一验收 |
| FR-19 | 系统应提供演示 CLI（S2）：`up/down/reset/seed/verify/check`，带环境登记、确认与事务化重置 | 两次 reset 结果一致；非 demo 数据保留 | 已实现待统一验收（`908cb5a`+`a849b29`；minimal 根`.env`不含`ready`，demo profile 另含`ready`；`logs`/`status`由 Infra 收尾后登记） |
| FR-20 | 系统应提供决策详情 UI（S2）：区分空/off/失败/未校准/来源，反馈入口注明"仅评估、不改变结论" | 三档宽度浏览器实测 | 已实现待统一验收（`cc942b2`：`decision-advice-panel.tsx`+验收 spec；截图归档待 S3） |

## 3. 非功能需求（NFR）

| ID | 需求 | 度量/验收 | 状态与证据 |
| --- | --- | --- | --- |
| NFR-01 可维护性 | 领域（`packages/audit`）不得依赖 HTTP/PG/Pi/React；适配器集中在 `apps/api` | 依赖方向可由 import 图检查；架构文档与代码一致 | 已实现且已验证（ADR-0001；`bun run typecheck` 两轮） |
| NFR-02 可靠性 | 单实例部署；PG 队列 `SKIP LOCKED`；Redis/对象存储可降级且不导致审计失败；缓存不可达须快速返回而非无限重试 | 降级矩阵实测（未配置/不可达）；Redis 不可达观测 33 ms 返回 disabled cache（`cache-failure-smoke.json`） | 部分验证：缓存失败已实测；真实 S3 故障回归待 QA 补（I5/Q3） |
| NFR-03 功能适合性 | 19 条规则覆盖采购/服务/建设/运维常见风险维度；disposition 四态可区分 | golden 集 + 规则目录研究；覆盖矩阵在演示文档 | 已实现且已验证（规则用例） |
| NFR-04 安全 | 密钥/口令绝不进 Git、日志、测试工件、URL 或**未授权**浏览器上下文；合同原文只允许经授权的证据界面渲染（按 Source Record 授权），不因"防泄露"而禁止授权展示 | 密钥扫描；API 不返回 key；`LLM_INTERNAL_DATA_ORIGINS` 默认空；授权/未授权访问对照 | 部分验证：访问门已实测；出网抓包验证待 QA（SEC4） |
| NFR-05 可移植性 | 一条 `compose.yaml` 描述开发/演示；应用容器自迁移；`AUDIT_AGENT_MODE=fake` 免凭证演示 | 第三方按 runbook 从零起步 | 已实现；第三方复现记录待 Infra 归集（I7） |
| NFR-06 性能（已知边界） | 单次完整审计约 62 s（约 20 次工具调用，真实 LLM 路径）；OCR 视觉模型 24.6 MB 扫描件约 396 s | 只报实测样本，不宣称吞吐指标 | 已实现且有历史实测（升级记录、ICT 调研 §5） |
| NFR-07 可访问性 | 桌面 1440×900 复核操作可达；窄屏 375px 亦须可达 | 浏览器实测可见操作数 | 修复已合并（`cc942b2`：375px 行为验收+1280/1440/1920 断言）；截图归档待 S3 |
| NFR-08 失败可观测 | 依赖故障必须留下稳定状态：trace/cache 不回显上游原始错误；主体核验真实失败不被合成豁免吞掉（保留失败状态与私有 Source Record，模型侧 basis 剥离上游 body/错误）；缓存不可达不得无限重试；会话失效关闭已建立 SSE | 隐私/降级回归；health 与日志行为；快照附加 `subjectVerificationProvider` 标注 | 已实现且已验证（`2d63f15` 及后续修复；`cache-failure-smoke.json`；7 项回归） |

## 4. 安全需求（SEC）

| ID | 需求 | 验收 | 状态 |
| --- | --- | --- | --- |
| SEC-01 | 访问门为单工作区口令门，不等于 SSO/RBAC；不得宣称多租户隔离 | 文档与实现一致 | 已实现且已验证 |
| SEC-02 | `X-Operator` 仅为归属标记，不是认证；须做 trim/128 字符/控制字符校验 | 畸形输入按缺省处理 | 已实现且已验证（`1f33d99`） |
| SEC-03 | 原件下载必须按 Source Record 查库授权后解析内部引用，不接受任意 `s3://` 或路径参数 | 越界拒绝用例 | 已实现待统一验收（`908cb5a`：目录/桶归属拒绝+行为测试；`storage-boundary-smoke.json` 实测） |
| SEC-04 | 原始/内部合同出网需**已授权 origin**（`LLM_INTERNAL_DATA_ORIGINS` 精确匹配）；已证明的合成内容 + 可信 fixture 上下文可豁免该白名单，无需配置列表 | 抓取实际发送字段；内置合成内容以 canonical hash 证明 | 策略已实现（`1f33d99`）；字段级抓包证据待 QA |
| SEC-05 | 模型输入最小化：身份、gold/comparison、完整请求、原始响应不进入模型 state 或公开 DTO | DTO 契约审查 + 请求体断言 | 已实现待统一验收（`a6ec041`：脱敏 DTO 测试入树）；字段级抓包待 S3 |
| SEC-06 | 密钥管理：demo/production 启动要求 `LLM_KEY_ENCRYPTION_SECRET` ≥32；轮换事务性重包且默认 dry-run | 轮换 runbook 与 dry-run/apply 证据 | 已实现且已验证（`cd24aac`；`key-rotation-smoke.json`、`startup-security.json`） |
| SEC-07 | 演示/测试重置必须环境保护：`APP_ENV` 限 demo/test、库身份登记、明确确认、保留非 demo 哨兵 | 两次 reset + 哨兵行数稳定 | 主体已实现待统一验收（`908cb5a`+`a849b29`）；Main 修正 qcc 核验 Source Record 重置遗漏中，修后回归 |
| SEC-08 | Prompt Injection 防护：合成恶意指令样本不得越权触发工具或改写结论 | 恶意样本回归 | 已实现待统一验收（`a6ec041`：受控问题目录与脱敏输入；恶意样本专项回归待 S3） |

## 5. Agent/影子治理需求（AI-*）

| ID | 需求 | 验收 | 状态 |
| --- | --- | --- | --- |
| AI-01 | 影子 provider 只有 disabled/fake/laya-cpu；无 Jev、无远程决策 adapter | 代码无远程决策调用路径 | 已实现且已验证（契约冻结） |
| AI-02 | 影子任务独立持久化（租约/次数/终态），不借用正式案件 PENDING 队列，正式 dispatcher 不等模型 HTTP | 独立 worker 冒烟 | 已实现待统一验收（`a6ec041`：shadow-worker+shadow_jobs；SQL 路径真实 PG 回归待 S3） |
| AI-03 | 冻结身份：Run+Snapshot+inputHash+question/policy/redaction 版本+provider/modelVersion；缺身份拒绝派生 | 幂等测试 | 已实现待统一验收（`a6ec041`：派生幂等+激活锁契约） |
| AI-04 | 未校准输出必须标 `calibrated=false`、`uncertainty`、`needsHumanReview=true`；不得把集中度表述为正确率 | DTO 字段断言 | 已实现（`a6ec041` DTO+`cc942b2` UI 标识）；字段断言回归待 S3 |
| AI-05 | Laya 仅接受服务端配置的 loopback/容器 origin；禁止重定向、userinfo、fragment | 端点校验测试 | 已实现待统一验收（`a6ec041`：laya-wire origin 校验+测试） |
| AI-06 | 保留期默认 `DECISION_RETENTION_DAYS=30`（1–365），只清理终态影子记录与反馈，不动正式数据 | dry-run/apply 边界测试 | 已实现待统一验收（`a6ec041`：保留期路由+活动租约不清理） |
| AI-07 | 影子故障（provider/队列/超时）不得使成功案件转 FAILED，不得改写 Snapshot/RuleAssessment/Finding/Review/Remediation | 故障注入对照 | 已实现（结构边界测试入树，`a6ec041`）；对照运行待 S3 |

## 6. 追溯（RTM）

- 机器可读 RTM：`docs/engineering/traceability.csv`（本 Agent 维护，含 FR/NFR/SEC/AI 与测试/证据链接）。
- 每个需求的状态字段与本文一致；变更时同步两处。
- QA 的分层测试报告（`docs/quality/`，QA 维护）是运行证据的权威来源；本文只引用其结论，不复制数字。

## 7. 明确不做（V1 范围外）

- SSO/RBAC/多租户/多副本部署；RAG；独立消息队列；报告中心；完整置信度校准研究（P2）；多模型对比实验（P2）。
- 这些缺口写入 FAQ 与风险文档，不用"后续版本"话术暗示已具备。
