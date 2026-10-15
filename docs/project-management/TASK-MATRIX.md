# 五 Agent 任务矩阵

> 历史记录：本矩阵保留2026-10-15五Agent/S0–S4阶段的交付事实，不再作为当前任务板更新。当前唯一任务板为[docs/project/TASK-BOARD.md](../project/TASK-BOARD.md)，现行三Agent文件所有权见[FILE-OWNERSHIP](../project/FILE-OWNERSHIP.md)。

基线：`d9a84a4`（2026-10-15）。五个 S2 功能切片已按纵向切片合并进 `main`，最新集成提交为 `a849b29`（fix(integration): correct demo reset deletes and lint regressions）；该提交后、当前未提交的决策契约修订（`apps/api/src/decision/runtime.ts`、`shadow-repository.ts`、`routes/decisions.ts/.test.ts`）由 Main 统一验收。状态以本文件链接的代码与实跑结果为准：**已实现待统一验收**表示代码已合并但尚未经 S3 统一回归确认；**已验证**表示有对应该 commit 的实跑证据；规划中的功能不是现有能力。主Agent统一负责环境、迁移、集成验证和阶段提交；S2文件所有权以[公共契约](../architecture/INTEGRATION-CONTRACT.md)为准。

## 阶段门禁

| 阶段 | Owner | 依赖 | 验收 | 当前状态 | 版本/证据 |
| --- | --- | --- | --- | --- | --- |
| S0 基线 | Main + 五份只读审计 | 已保存工作区 | 历史、环境、真实测试、已完成/缺口矩阵与风险 | 完成；保留1个E2E过期用例（QA已修正，见Q6）及窄屏缺陷（UX已修复，见F5，待统一回归确认） | [BASELINE](./BASELINE.md)，审计提交`a4c6119`；输入`d9a84a4` |
| S1 公共契约 | Main | S0 | G1–G7：版本/错误/幂等、隐私/授权/保留、迁移回滚、Laya前置、任务与worktree冻结 | 完成：lint、两轮typecheck、670测试及明确Fake的JSON消费smoke通过；五个worktree已创建 | [INTEGRATION-CONTRACT](../architecture/INTEGRATION-CONTRACT.md)、[S1实测](./evidence/s1-verification.json) |
| S2 独立实施 | 五Agent + Main | S1 | 下表逐项实现和smoke | 大部分条目已实现待统一验收；未实现项逐行标明（见下表；决策契约修订未提交部分由Main收尾） | 下表；合并提交 `a6ec041`/`908cb5a`/`cc942b2`/`f7ce8d1`/`de7ea2d`/`31bb8d1`/`a849b29` |
| S3 集成回归 | Main + QA | S2 | 无外部密钥的单元/集成/E2E、Docker、故障与重复reset；发布就绪报告 | 未开始（各切片自带smoke不替代统一回归） | `docs/quality/RELEASE-READINESS.md`（Main 拥有） |
| S4 交付 | Main + Docs | S3 | 真实证据、截图、复现指南、历史/未来分开的Gantt与风险 | 进行中：工程与竞赛文档已入树（`31bb8d1`），按实际交付持续校正 | `docs/competition/` |

## Agent 1：质量与工程治理

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1 | P0 | 需求—设计—代码—测试—证据RTM | 已建立机器可读RTM：`docs/engineering/traceability.csv`（44行，FR/NFR/SEC/AI映射）与`docs/quality/traceability.csv`（E2E需求映射）；19条规则中17条有golden标签，主体与历史规则由专门测试覆盖 | 19条均映射到实际回归，不混同golden与独立测试 | QA | S | `docs/quality/traceability.csv`、`docs/engineering/traceability.csv` | 已实现待统一验收（`31bb8d1`） |
| Q2 | P0 | 分层覆盖率基线 | LCOV已产出：单元行81.1%/函数82.8%；Bun 1.4.3 LCOV无`BRDA`记录，**分支覆盖率不可测量**，报告为`null`，不以行冒充分支 | 行/函数、集成场景、E2E需求分开统计；不可测分支明确标注 | QA | M | `artifacts/qa/coverage/lcov.info`、`docs/quality/COVERAGE-BASELINE.md` | 已实现待统一验收（`de7ea2d`） |
| Q3 | P0 | 完善领域、DB、S3、Redis、SSE、权限与浏览器回归 | 新增真实缝集成测试：PG生命周期（排他领取/快照/SSE首帧）、Redis三路径、S3真实往返与存储边界、访问门禁（401/登录/登出/重放/Bearer）；需要真实服务的集成在本机未运行（5432/6379/9000未监听），S3边界有`storage-boundary-smoke.json`实测 | 复用现有fakes与隔离PG，新增行为测试 | QA | L | `tests/integration/`、[storage-boundary-smoke](./evidence/storage-boundary-smoke.json) | 已实现待统一验收（`de7ea2d`、`f7ce8d1`） |
| Q4 | P0 | 规范测试入口与机器报告 | 已实现分层入口`Makefile`（test-unit/test-integration/test-e2e/coverage/verify/qa-report）与`scripts/qa/report.ts`机器报告（stdout+stderr合并计数、E2E只读本轮JSON、输出脱敏、Chromium实测探测）；冻结基线`6a59906`实测670 pass/0 fail | 保留原命令，新增可运行入口与SHA/退出码 | QA | M | `Makefile`、`docs/quality/TEST-REPORT.md` | 已实现待统一验收（`de7ea2d`） |
| Q5 | P0 | CI服务及工件 | CI workflow已扩展（`quality` job lint/typecheck/单测 + `acceptance` job起PG跑Playwright）；不使用外部LLM凭证，`AUDIT_AGENT_MODE=fake`；覆盖率/trace工件job的实跑记录待S3归档 | 不使用外部LLM凭证；机器摘要、LCOV与失败工件可归档 | QA | M | `.github/workflows/ci.yml` | 已实现待统一验收（`de7ea2d`） |
| Q6 | P0 | 故障、重复操作、上传与泄露回归 | 已实现：`scripts/qa/faults.ts`覆盖Redis不可达仍成功、S3回落本地、非法路由/UUID不伪装500、超大/伪造/路径穿越上传被拒；过期rerun E2E已重写为新案/旧案不变量（`tests/acceptance/audit-case.spec.ts`）；清理helper统一数据库身份解析（不再直读`.env`，RISK-01已修） | 故障明确，正式审计不受影子失败污染 | QA | L | `scripts/qa/faults.ts`、`tests/acceptance/db-cleanup.ts` | 已实现待统一验收（`de7ea2d`） |

## Agent 2：部署、对象存储与数据复现

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I1 | P0 | Compose版本、端口、健康、卷与资源 | 已实现：镜像全部digest固定（postgres:18/rustfs:1.0.1/redis:7-alpine/aws-cli:2.32.5），端口默认绑`127.0.0.1`且可变量收窄，开发/演示一套定义 | 可复制本机配置，区分demo与生产设置 | Infra | S | `compose.yaml`、`docker compose config --quiet` | 已实现待统一验收（`908cb5a`） |
| I2 | P0 | S3原件完整读写/locator/权限/完整性 | 已实现：original-store真实往返、路径/桶归属拒绝、`S3_STRICT`语义（demo/production写失败即失败；显式`s3-fallback-local`才回退）；存储边界有实测JSON | 原字节hash一致、错误不伪报写入成功 | Infra | L | `apps/api/src/document/original-store.ts`、[storage-boundary-smoke](./evidence/storage-boundary-smoke.json) | 已实现待统一验收（`908cb5a`） |
| I3 | P0 | demo作用域安全重置 | 已实现：demo环境登记（`demo_environments`表、库身份/确认值校验）、非demo记录保留、重复reset幂等；`a849b29`修正reset删除范围 | 保留非demo记录，重复结果一致，禁止全库清空 | Infra | L | `apps/api/src/demo/`、`demo:reset ×2 + non-demo sentinel` | 已实现待统一验收（`908cb5a`+`a849b29`） |
| I4 | P0 | demo-up/reset/check/down | 已实现受管CLI：minimal（根`.env`）`up\|down\|reset\|seed\|verify\|check`，demo profile（受管`.demo.env`）另含`ready`；`logs`/`status`由Infra本轮补齐后另定文档口径；package.json `demo:*`入口与`scripts/demo/backup-restore.ts`（仅受管`.demo.env`）入树；四入口可运行、可诊断、可停止自建服务 | 四入口可运行、可诊断、可停止自建服务 | Infra | M | `scripts/demo/cli.ts`、`docs/deployment/demo.md` | 已实现待统一验收（`908cb5a`+Infra收尾） |
| I5 | P0 | 依赖降级矩阵 | 已实现：S3本地回退（显式）、Redis直连/关闭、fake已有；真实依赖故障与恢复行为有集成用例与`qa:faults`覆盖（真实服务未在本机运行，见Q3） | 真实依赖异常与恢复；PG失败明确；Laya不影响正式结果 | Infra + QA | L | `scripts/qa/faults.ts`、`tests/integration/` | 已实现待统一验收（`908cb5a`、`de7ea2d`） |
| I6 | P0 | 配置、最小备份/恢复、部署与权限说明 | 已实现：`docs/deployment/`（demo.md两种profile、必备变量、备份恢复）与`.env.example`扩充；备份/恢复脚本入树 | 不打印密钥，文档命令与实测一致，恢复只进新测试库 | Infra | L | `docs/deployment/`、`scripts/demo/backup-restore.ts` | 已实现待统一验收（`908cb5a`） |
| I7 | P0 | minimal与full/optional | 已实现：minimal（无模型密钥、fake、本地原件）与full（访问口令+加密secret、严格S3）两种profile，选择经环境变量；文档记录口径 | minimal无模型密钥；optional显式启用；记录真实启动耗时 | Infra | M | `docs/deployment/demo.md` | 已实现待统一验收（`908cb5a`） |

## Agent 3：独立决策与影子治理

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A0 | P0 | 仅本地Laya：官方接口、许可、CPU/中文部署实测 | 部署/冒烟脚本已实现（verify/install/start/smoke）；单请求CPU冒烟已实测并归档（642 ms、未校准）；**真实数据集推理与全量评测未跑**（待Main集成后运行）；Jev已取消 | 固定代码/模型revision，CPU真实smoke；无法运行则提供具体阻塞 | AI + Main | L | `docs/ai/laya-cpu-smoke.md`、[laya-cpu-smoke](./evidence/laya-cpu-smoke.json) | 部分实现（冒烟已验证；全量评测待S3） |
| A1 | P0 | 独立DecisionProvider | 已实现：`apps/api/src/decision/`（契约+派生+运行时），S1固定Interface；不更改AuditAgentPort职责 | S1固定Interface；不更改AuditAgentPort职责 | AI | M | `apps/api/src/decision/` | 已实现待统一验收（`a6ec041`） |
| A2 | P0 | Disabled/Fake/LayaCpu Adapter | 已实现：`providers/disabled.ts`、`fake.ts`、`laya-cpu.ts`+`laya-wire.ts`；off不调用；仅受控本地origin；无Jev、无远程决策密钥；LayaCpu线上契约按固定SHA源码与Main实测422校正；错误不伪造答案 | off不调用；仅受控本地origin；无Jev、无远程决策密钥；错误不伪造答案 | AI | M | `apps/api/src/decision/providers/` | 已实现待统一验收（`a6ec041`） |
| A3 | P0 | off/shadow开关 | 已实现：`DECISION_MODE`（off/shadow，默认off）；派生守卫在派生路径，worker不承载开关；off不创建/不领取/不推理 | 默认off；影子不写Finding、规则、人工审批或工具命令 | AI | L | `apps/api/src/decision/config.ts`、`scripts/decision/smoke.ts` | 已实现待统一验收（`a6ec041`） |
| A4 | P1 | 至少60条中文合成条款与标签 | 已建立：60条、10类、正/反/模糊/例外/跨条款，带理由与`reviewStatus`；**开发参考标签，未经独立专家签核**（RISK-09不变） | 覆盖十类、否定/例外/模糊/跨条款；如无专家签核必须标开发标签 | AI | M | `tests/fixtures/decision/` | 已实现待统一验收（`a6ec041`） |
| A5 | P1 | 公平评测与质量/性能报告 | 评测脚本已实现（同任务同输入，fake与laya-cpu分路径报告，拒答单列不折算）；**全量Laya评测数值待S3运行**，未跑路径不填数 | 固定输入与Pi输出，记录F1/P/R/混淆/拒判/p50/p95/资源；未跑路径不填数 | AI + Main | L | `scripts/decision/evaluate.ts`、`docs/ai/evaluation.md` | 已实现待统一验收（`a6ec041`） |
| A6 | P1 | 持久化影子、差异、版本、恢复与关闭 | 已实现：`shadow-repository.ts`（内存+SQL同契约）、`shadow-worker.ts`（租约互斥/过期恢复/幂等派生）、`shadow_jobs`/`shadow_feedback`/`demo_environments`迁移（0018）；**SQL路径未经真实PG集成测试**；AgentRun冻结身份关联已实现 | 冻结准确输入身份、独立扫描、幂等、有界重试，保持正式状态 | AI + Main | L | `apps/api/src/decision/shadow-worker.ts`、迁移`0018_faithful_phil_sheldon.sql` | 已实现待统一验收（`a6ec041`、`f7ce8d1`） |
| A7 | P1 | 脱敏决策详情/保留/权限策略 | 已实现：`routes/decisions.ts`详情/反馈/保留期路由（幂等201/409、UUID形状404、X-Operator归属、活动租约不清理）；与UI同一DTO；不暴露密钥、完整原文或提示词；当前有未提交契约修订待Main验收 | 与UI同一DTO；不暴露密钥、完整原文或提示词 | AI | M | `apps/api/src/routes/decisions.ts` | 已实现待统一验收（`a6ec041`+未提交修订） |
| A8 | P1 | 独立反馈与原规则不变回归 | 已实现：反馈append-only、幂等，独立于Finding Review；规则/Guard回归由既有套件覆盖 | append-only反馈独立于Finding Review；19规则/Guard不变 | AI + QA | M | `apps/api/src/routes/decisions.ts`反馈路由、`tests/acceptance/decision-advice.spec.ts` | 已实现待统一验收（`a6ec041`） |

## Agent 4：业务体验

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | P1 | 上传→证据→复核→整改实地走查 | 行为验收入树（`tests/acceptance/ux-workflow.spec.ts`）；相同合成数据的前后对照截图与失败依据仍待S3归档 | 相同合成数据的前后截图、操作步骤与失败依据 | UX + Main | M | `tests/acceptance/ux-workflow.spec.ts`、`docs/ux/` before/after screenshots | 已实现待统一验收（`cc942b2`） |
| F2 | P1 | 复用Ant Design及tokens | 已保持React19/Ant Design6体系小步一致性（`decision-advice-panel.tsx`、`access-gate.tsx`），不迁移框架 | 小步一致性，不迁移框架 | UX | S | `apps/web/` + browser smoke | 已实现待统一验收（`cc942b2`） |
| F3 | P1 | 队列、定位、分组、运行/复核/整改状态 | 工作台改造并入（`audit-case-workbench.tsx`接入决策面板与访问会话）；过期rerun验收已由QA按新语义重写 | 改实际缺口，保持证据链与状态清楚 | UX + QA | L | `upload→evidence→review→remediation browser smoke` | 已实现待统一验收（`cc942b2`） |
| F4 | P1 | 决策治理详情与来源/未校准提示 | 已实现：`decision-advice-panel.tsx`+`decision-presentation.ts`（影子建议、来源、未校准标识、空态"未提供"非0%）+`/decision-advice`路由；配套验收`tests/acceptance/decision-advice.spec.ts` | S1 DTO→真实API；辅助意见不伪装正式结论 | UX | L | `tests/acceptance/decision-advice.spec.ts` | 已实现待统一验收（`cc942b2`） |
| F5 | P1 | 可访问性与尺寸适配 | 已实现：375px风险/原文/复核入口恢复（`ux-workflow.spec.ts`实测375提交复核并回读）、1280/1440/1920三栏同可用断言；键盘/label/焦点走查与1440×900/1920×1080截图待S3归档；不做正式认证声称 | 实测键盘/label/焦点，1440×900与1920×1080，无正式认证声称 | UX | M | `tests/acceptance/ux-workflow.spec.ts`（375/1280/1440/1920） | 已实现待统一验收（`cc942b2`） |
| F6 | P1 | 行为验收、截图与实际加载指标 | Playwright行为验收已入树（role/label定位、真实运行）；影子路径与对照证据、真实加载指标待S3 | role/label定位、真实运行，未测不报提升比例 | UX + QA | M | `tests/acceptance/ux-workflow.spec.ts` | 已实现待统一验收（`cc942b2`） |

## Agent 6：网站视觉重设计（用户新增）

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | P1 | 全站视觉重设计（用户显式请求）：React19+AntD6/TanStack桌面web；企业SaaS专业浅色方向（navy `#0F172A`、blue `#0369A1`、light `#F8FAFC`、white表面、slate `#475569`次级、语义风险色）；保留中文UI、现有路由与真实API数据、Ant自带图标与本地中文字体；不新增UI框架/外部字体/GSAP/图标依赖；CSS tokens与Ant主题对齐；键盘焦点可见、reduced motion；不做dark mode | 实施中（VisualRedesign进行中）；shell/仪表盘视觉提升与375px面板控制保留待交付 | 桌面留白与层级实质改善；375/1280/1440/1920四档视口+键盘操作通过Playwright并留存截图；375px面板控制不回退 | VisualRedesign | M | `apps/web/src/styles.css`、`apps/web/src/components/`、四档视口+键盘截图与spec | 实施中 |

## Agent 5：工程文档与竞赛

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | P1 | Git历史、WBS、里程碑与Gantt | 已建立：`docs/engineering/gantt.md`历史全部附真实SHA（M1–M24+）、未来到11-10全部标规划、`gantt.csv`可编辑数据；随交付推进需补S2合并里程碑 | 每个历史节点有真实SHA，未来到11-10明确标规划 | Docs | L | `docs/engineering/gantt.md` | 已实现待统一验收（`31bb8d1`） |
| R2 | P1 | SRS-lite、流程、C4、ADR、非功能证据 | 已建立：`docs/engineering/requirements.md`、`c4-and-adr-index.md`、`acceptance-criteria.md`、`test-strategy.md`、`runbook-index.md`、RTM；对需求与代码、测试可追踪 | 复用现有资料，对需求与代码、测试可追踪 | Docs | L | `docs/engineering/requirements.md` | 已实现待统一验收（`31bb8d1`） |
| R3 | P1 | 文档一致性 | 已校正：README（MinerU已实现口径、文档索引、能力边界）、runbook（startup.md迁移表数、mvp-local路由表）；本矩阵21表口径随S2合并同步（startup.md注为18业务表+3张S2新表） | 改为当前实际能力，运行命令实际有效 | Docs | M | `README.md + runbook command smoke` | 已实现待统一验收（`31bb8d1`） |
| R4 | P1 | 竞品与开源矩阵 | 已建立：`docs/competition/COMPETITOR-MATRIX.md`（官方来源+访问日期+局限）；引用保留原始限定与已核许可 | 本轮补核官方来源、访问日期、部署/隐私/证据/成本局限 | Docs | L | `docs/competition/COMPETITOR-MATRIX.md` | 已实现待统一验收（`31bb8d1`） |
| R5 | P1 | 创新与自主模块映射 | 已建立：`docs/competition/INNOVATIONS.md`（自主vs第三方逐层、每项代码/演示证据）；影子条目状态随S2合并更新 | 区分自主工程与第三方基础模型、每项有代码/演示证据 | Docs | M | `docs/competition/INNOVATIONS.md` | 已实现待统一验收（`31bb8d1`） |
| R6 | P1 | 7–10分钟离线演示 | 已建立：`docs/competition/DEMO-SCRIPT.md`三/五/八分钟+技术版逐步脚本；演示CLI命令需与Main收尾后的受管CLI最终形态核对后定稿 | health→安全reset→合成合同→审计复核→可用影子→trace/S3→测试→复制 | Docs | M | `docs/competition/DEMO-SCRIPT.md` | 已实现待统一验收（`31bb8d1`；命令核对进行中） |
| R7 | P1 | 评委FAQ | 已建立：`docs/competition/JUDGE-FAQ.md`（取舍均附代码/ADR/证据位置） | 问答均有实际约束与依据 | Docs | S | `docs/competition/JUDGE-FAQ.md` | 已实现待统一验收（`31bb8d1`） |
| R8 | P1 | KPI定义与测量 | 已建立：`docs/competition/METRICS.md`（K1–K12口径；已测项附commit上下文，未测项只写测量计划） | 未测指标只写测量计划，不编造生产收益 | Docs | S | `docs/competition/METRICS.md` | 已实现待统一验收（`31bb8d1`） |

S2条目状态以上表为准："已实现待统一验收"=代码已合并、S3统一回归前不算已验证；"已验证"=有对应commit实跑证据（如S1契约18测试`6a59906`、访问门`s2-security.json`、存储边界`storage-boundary-smoke.json`、Laya单样本冒烟）。本表更新不改变历史基线（[BASELINE](./BASELINE.md)保留其当时事实）。阶段提交后更新证据与commit，不用规划日期代替完成日期。

## 安全治理及真实模型验证

工作量以改动范围标记：S为局部修改，M为跨文件切片，L为跨层或依赖真实服务的切片。验收列列出目标证据，不表示尚未运行的检查已经通过。Owner与依赖适用于每一行；Main统一迁移、环境和最终提交。

| ID | 优先级 | 具体工作 | Owner | 依赖 | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC1 | P0 | 替换演示凭据、密钥重封装/轮换、部署访问保护 | Main + Infra | I1、I6、统一访问门禁 | L | 配置无固定生产密钥；轮换前后读取；匿名401/授权成功 | 部分已验证：轮换实测`key-rotation-smoke.json`、启动重封`startup-security.json`（`cd24aac`）；部署侧待S3统一验收 |
| SEC2 | P0 | 上传大小/格式、路径穿越、异常PDF/DOCX与存储归属 | Infra + QA | I2、Q3 | L | 原件hash；拒绝跨目录/跨桶；异常输入行为测试 | 已实现待统一验收（`908cb5a`）：行为测试+`storage-boundary-smoke.json`实测 |
| SEC3 | P0 | 审计、原件、SSE及影子详情服务端授权 | Main + UX + QA | S1访问口令契约 | L | 匿名拒绝；登录/退出；授权下载/详情；密钥不落URL/日志 | 已验证（HTTP层）：[s2-security](./evidence/s2-security.json)（匿名401/授权200/登出204/重放401，`1f33d99`）+ SSE吊销（`b2033e1`）；影子详情授权待S3回归 |
| SEC4 | P0 | 模型最小脱敏输入与外部真实合同出网默认禁止 | Main + AI + QA | A1–A3、模型origin策略 | L | 捕获实际发送字段；原始标识/gold/comparison不外发 | 已实现待统一验收：策略代码+守卫（`b2033e1`）；字段级抓包待QA归集 |
| SEC5 | P0 | 脱敏访问日志、读取限制与影子保留/清理 | Main + AI | A6–A8、SEC3 | L | 过期终态清理/活动保留；公开DTO无原始payload或密钥 | 已实现待统一验收（`a6ec041`）：保留期路由+脱敏DTO测试 |
| SEC6 | P0 | 明确存储降级及敏感数据持久化边界 | Infra + QA | I2、I5 | M | strict写失败明确；显式local模式；健康/记录显示实际后端 | 已实现待统一验收（`908cb5a`）：strict/local语义+health实际后端 |
| PI-LIVE | P0 | 指定本地DeepSeek网关真实Pi合成合同审计 | Main | S1、真实provider配置、服务健康 | L | 真实工具/trace/时延/Guard与证据引用；不发送用户原文 | 部分已验证：单合成样本两次实测[real-pi-smoke](./evidence/real-pi-smoke.json)（29727/30365 ms、Guard通过、快照不可变）；全流程真实验证待S3 |

## 分级与持续交付

- G1–G7的S1契约、Owner和检查产物见[Architecture Gate](../architecture/INTEGRATION-CONTRACT.md)。S1由Main负责，依赖S0；每项为M范围，凭公共DTO、边界测试、五个worktree及S1提交验收。
- S2五份功能切片已合并（AI `a6ec041`、Infra `908cb5a`、UX `cc942b2`、DB `f7ce8d1`、QA `de7ea2d`、Docs `31bb8d1`，集成修正 `a849b29`）；Main在`a849b29`观察`bun run verify` 835通过/0失败，其后未提交的决策契约修订（runtime/shadow-repository/decisions路由）由Main收尾并重新验证；统一verify、集成、浏览器、构建与环境复现属S3。
- A7基础详情/保留及A8独立反馈已随S2切片实现（待统一验收）。完整置信度校准研究、高级反馈分析和多版本模型实验明确为延期P2，不阻塞V1；Jev接入取消。
- Agent 6视觉重设计为用户新增并行任务，随S2/S3节奏交付，验收见V1行。
- 11月5日起规划仅修复交付缺陷、安全与文档；11月10日为V1目标，任何规划节点不得当作历史完成事实。
