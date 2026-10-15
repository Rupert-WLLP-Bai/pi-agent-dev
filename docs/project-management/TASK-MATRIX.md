# 五 Agent 任务矩阵

基线：`d9a84a4`（2026-10-15）。状态以本文件链接的代码与实跑结果为准。规划中的功能不是现有能力。主Agent统一负责环境、迁移、集成验证和阶段提交；S2文件所有权以[公共契约](../architecture/INTEGRATION-CONTRACT.md)为准。

## 阶段门禁

| 阶段 | Owner | 依赖 | 验收 | 当前状态 | 版本/证据 |
| --- | --- | --- | --- | --- | --- |
| S0 基线 | Main + 五份只读审计 | 已保存工作区 | 历史、环境、真实测试、已完成/缺口矩阵与风险 | 审计完成；保留1个E2E失败及窄屏缺陷 | [BASELINE](./BASELINE.md)，审计提交`a4c6119`；输入`d9a84a4` |
| S1 公共契约 | Main | S0 | G1–G7：版本/错误/幂等、隐私/授权/保留、迁移回滚、Laya前置、任务与worktree冻结 | lint、两轮typecheck、670测试及明确Fake的JSON消费smoke通过；五个worktree已创建 | [INTEGRATION-CONTRACT](../architecture/INTEGRATION-CONTRACT.md)、[S1实测](./evidence/s1-verification.json) |
| S2 独立实施 | 五Agent + Main | S1 | 下表逐项实现和smoke | 未实施 | 下表 |
| S3 集成回归 | Main + QA | S2 | 无外部密钥的单元/集成/E2E、Docker、故障与重复reset；发布就绪报告 | 未实施 | `docs/quality/RELEASE-READINESS.md` |
| S4 交付 | Main + Docs | S3 | 真实证据、截图、复现指南、历史/未来分开的Gantt与风险 | 未实施 | `docs/competition/` |

## Agent 1：质量与工程治理

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1 | P0 | 需求—设计—代码—测试—证据RTM | 未建立；19条规则中17条有golden标签，主体与历史规则由专门测试覆盖 | 19条均映射到实际回归，不混同golden与独立测试 | QA | S | `docs/quality/traceability.csv` | 待实施 |
| Q2 | P0 | 分层覆盖率基线 | 未配置LCOV；Bun原生分支指标待核实 | 行/函数、集成场景、E2E需求分开统计；不可测分支明确标注 | QA | M | `artifacts/qa/<SHA>/coverage/` | 待实施 |
| Q3 | P0 | 完善领域、DB、S3、Redis、SSE、权限与浏览器回归 | 652项测试和38例浏览器用例已存在；真实Redis/S3与SSE不足 | 复用现有fakes与隔离PG，新增行为测试 | QA | L | `tests/integration/` | 待实施 |
| Q4 | P0 | 规范测试入口与机器报告 | 仅已有verify/test/acceptance等；无分层入口和报告 | 保留原命令，新增可运行入口与SHA/退出码 | QA | M | `artifacts/qa/<SHA>/summary.json` | 待实施 |
| Q5 | P0 | CI服务及工件 | CI仅有PG，缺覆盖率/trace工件与Redis/S3 job | 不使用外部LLM凭证；机器摘要、LCOV与失败工件可归档 | QA | M | `.github/workflows/ci.yml` | 待实施 |
| Q6 | P0 | 故障、重复操作、上传与泄露回归 | 内存级失败已测；真实服务、清理配置统一与影子失败缺失 | 故障明确，正式审计不受影子失败污染 | QA | L | `artifacts/qa/<SHA>/faults.json` | 待实施 |

## Agent 2：部署、对象存储与数据复现

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I1 | P0 | Compose版本、端口、健康、卷与资源 | 既有PG/RustFS/Redis可启动；aws-cli使用latest，端口全部暴露 | 可复制本机配置，区分demo与生产设置 | Infra | S | `docker compose config --quiet` | 待实施 |
| I2 | P0 | S3原件完整读写/locator/权限/完整性 | 适配器存在，尚无真实往返证据；需加强路径/桶约束 | 原字节hash一致、错误不伪报写入成功 | Infra | L | `artifacts/qa/<SHA>/storage.json` | 待实施 |
| I3 | P0 | demo作用域安全重置 | 既有demoSeed归属与seed/reset逻辑；缺统一环境保护和DB级重复证据 | 保留非demo记录，重复结果一致，禁止全库清空 | Infra | L | `demo:reset ×2 + non-demo sentinel` | 待实施 |
| I4 | P0 | demo-up/reset/check/down | 只有dev-up与seed:demo | 四入口可运行、可诊断、可停止自建服务 | Infra | M | `demo:up/reset/check/down` | 待实施 |
| I5 | P0 | 依赖降级矩阵 | S3本地回退、Redis直连、fake已有 | 真实依赖异常与恢复；PG失败明确；Laya不影响正式结果 | Infra + QA | L | `artifacts/qa/<SHA>/degradation.json` | 待实施 |
| I6 | P0 | 配置、最小备份/恢复、部署与权限说明 | env/健康/运维文档已有但不完整 | 不打印密钥，文档命令与实测一致，恢复只进新测试库 | Infra | L | `docs/deployment/` | 待实施 |
| I7 | P0 | minimal与full/optional | fake模式已有，未包装可复现profile | minimal无模型密钥；optional显式启用；记录真实启动耗时 | Infra | M | `docs/deployment/demo.md` | 待实施 |

## Agent 3：独立决策与影子治理

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A0 | P0 | 仅本地Laya：官方接口、许可、CPU/中文部署实测 | 固定revision的研究已完成；模型推理尚未实跑；Jev已取消 | 固定代码/模型revision，CPU真实smoke；无法运行则提供具体阻塞 | AI + Main | L | `docs/ai/laya-cpu-smoke.md` | 待实施 |
| A1 | P0 | 独立DecisionProvider | 未实现 | S1固定Interface；不更改AuditAgentPort职责 | AI | M | `apps/api/src/decision/` | 待实施 |
| A2 | P0 | Disabled/Fake/LayaCpu Adapter | 未实现 | off不调用；仅受控本地origin；无Jev、无远程决策密钥；错误不伪造答案 | AI | M | `apps/api/src/decision/providers/` | 待实施 |
| A3 | P0 | off/shadow开关 | 未实现 | 默认off；影子不写Finding、规则、人工审批或工具命令 | AI | L | `off/shadow formal-output comparison` | 待实施 |
| A4 | P1 | 至少60条中文合成条款与标签 | 未建立 | 覆盖十类、否定/例外/模糊/跨条款；如无专家签核必须标开发标签 | AI | M | `tests/fixtures/decision/` | 待实施 |
| A5 | P1 | 公平评测与质量/性能报告 | 只有不同语义的规则golden评估 | 固定输入与Pi输出，记录F1/P/R/混淆/拒判/p50/p95/资源；未跑路径不填数 | AI + Main | L | `docs/ai/evaluation.md` | 待实施 |
| A6 | P1 | 持久化影子、差异、版本、恢复与关闭 | 无实现；AgentRun尚无snapshot关联 | 冻结准确输入身份、独立扫描、幂等、有界重试，保持正式状态 | AI + Main | L | `shadow lease/restart/idempotency smoke` | 待实施 |
| A7 | P1 | 脱敏决策详情/保留/权限策略 | 无实现 | 与UI同一DTO；不暴露密钥、完整原文或提示词 | AI | M | `GET /api/decisions/:id + auth/retention smoke` | 待实施 |
| A8 | P1 | 独立反馈与原规则不变回归 | 无实现 | append-only反馈独立于Finding Review；19规则/Guard不变 | AI + QA | M | `feedback idempotency + 19 rules/Guard regression` | 待实施 |

## Agent 4：业务体验

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | P1 | 上传→证据→复核→整改实地走查 | 已看到1440×900空队列；现有全流程验收37通过/1失败 | 相同合成数据的前后截图、操作步骤与失败依据 | UX + Main | M | `docs/ux/ before/after screenshots` | 待实施 |
| F2 | P1 | 复用Ant Design及tokens | 已有React19/Ant Design6体系 | 小步一致性，不迁移框架 | UX | S | `apps/web/ + browser smoke` | 待实施 |
| F3 | P1 | 队列、定位、分组、运行/复核/整改状态 | 核心三栏/过滤/流程已实现；重新审计验收契约过期 | 改实际缺口，保持证据链与状态清楚 | UX + QA | L | `upload→evidence→review→remediation browser smoke` | 待实施 |
| F4 | P1 | 决策治理详情与来源/未校准提示 | 无影子UI | S1 DTO→真实API；辅助意见不伪装正式结论 | UX | L | `tests/acceptance/decision-advice.spec.ts` | 待实施 |
| F5 | P1 | 可访问性与尺寸适配 | 既有部分移动/平板验收 | 实测键盘/label/焦点，1440×900与1920×1080，无正式认证声称 | UX | M | `375/1280/1440/1920px + keyboard smoke` | 待实施 |
| F6 | P1 | 行为验收、截图与实际加载指标 | 已有Playwright；缺影子路径和对照证据 | role/label定位、真实运行，未测不报提升比例 | UX + QA | M | `tests/acceptance/ux-workflow.spec.ts` | 待实施 |

## Agent 5：工程文档与竞赛

| ID | 优先级 | 具体工作 | 现状/缺口 | 依赖与验收 | Owner | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | P1 | Git历史、WBS、里程碑与Gantt | 日期计划已有，无可编辑历史/未来分离图 | 每个历史节点有真实SHA，未来到11-10明确标规划 | Docs | L | `docs/engineering/gantt.md` | 待实施 |
| R2 | P1 | SRS-lite、流程、C4、ADR、非功能证据 | ADR/架构/旧方案已有，缺统一工程索引 | 复用现有资料，对需求与代码、测试可追踪 | Docs | L | `docs/engineering/requirements.md` | 待实施 |
| R3 | P1 | 文档一致性 | README MinerU空槽位、架构17规则、手册13表均过期 | 改为当前实际能力，运行命令实际有效 | Docs | M | `README.md + runbook command smoke` | 待实施 |
| R4 | P1 | 竞品与开源矩阵 | 已有09-14官方资料调研 | 本轮补核官方来源、访问日期、部署/隐私/证据/成本局限 | Docs | L | `docs/competition/competitor-analysis.md` | 待实施 |
| R5 | P1 | 创新与自主模块映射 | 部分机制描述已有 | 区分自主工程与第三方基础模型、每项有代码/演示证据 | Docs | M | `docs/competition/innovation-evidence.md` | 待实施 |
| R6 | P1 | 7–10分钟离线演示 | 有demo页，无完整逐步脚本 | health→安全reset→合成合同→审计复核→可用影子→trace/S3→测试→复制 | Docs | M | `docs/competition/demo-script.md` | 待实施 |
| R7 | P1 | 评委FAQ | 缺统一文件 | 问答均有实际约束与依据 | Docs | S | `docs/competition/faq.md` | 待实施 |
| R8 | P1 | KPI定义与测量 | 有散落指标定义，缺一致口径 | 未测指标只写测量计划，不编造生产收益 | Docs | S | `docs/competition/metrics.md` | 待实施 |

所有S2条目当前仍为“待实施/待验收”；本表的既有能力不代表本轮新增已完成。阶段提交后更新证据与commit，不用规划日期代替完成日期。

## 安全治理及真实模型验证

工作量以改动范围标记：S为局部修改，M为跨文件切片，L为跨层或依赖真实服务的切片。验收列列出目标证据，不表示尚未运行的检查已经通过。Owner与依赖适用于每一行；Main统一迁移、环境和最终提交。

| ID | 优先级 | 具体工作 | Owner | 依赖 | 工作量 | 验收证据/目标路径 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC1 | P0 | 替换演示凭据、密钥重封装/轮换、部署访问保护 | Main + Infra | I1、I6、统一访问门禁 | L | 配置无固定生产密钥；轮换前后读取；匿名401/授权成功 | 待实施 |
| SEC2 | P0 | 上传大小/格式、路径穿越、异常PDF/DOCX与存储归属 | Infra + QA | I2、Q3 | L | 原件hash；拒绝跨目录/跨桶；异常输入行为测试 | 待实施 |
| SEC3 | P0 | 审计、原件、SSE及影子详情服务端授权 | Main + UX + QA | S1访问口令契约 | L | 匿名拒绝；登录/退出；授权下载/详情；密钥不落URL/日志 | 待实施 |
| SEC4 | P0 | 模型最小脱敏输入与外部真实合同出网默认禁止 | Main + AI + QA | A1–A3、模型origin策略 | L | 捕获实际发送字段；原始标识/gold/comparison不外发 | 待实施 |
| SEC5 | P0 | 脱敏访问日志、读取限制与影子保留/清理 | Main + AI | A6–A8、SEC3 | L | 过期终态清理/活动保留；公开DTO无原始payload或密钥 | 待实施 |
| SEC6 | P0 | 明确存储降级及敏感数据持久化边界 | Infra + QA | I2、I5 | M | strict写失败明确；显式local模式；健康/记录显示实际后端 | 待实施 |
| PI-LIVE | P0 | 指定本地DeepSeek网关真实Pi合成合同审计 | Main | S1、真实provider配置、服务健康 | L | 真实工具/trace/时延/Guard与证据引用；不发送用户原文 | 待实施 |

## 分级与持续交付

- G1–G7的S1契约、Owner和检查产物见[Architecture Gate](../architecture/INTEGRATION-CONTRACT.md)。S1由Main负责，依赖S0；每项为M范围，凭公共DTO、边界测试、五个worktree及S1提交验收。
- S2只在S1冻结后开始；Main按纵向切片创建功能提交并及时集成，针对路径smoke；最后统一verify、集成、浏览器、构建与环境复现。各Agent不自行迁移或提交。
- A7基础详情/保留及A8独立反馈属于P1。完整置信度校准研究、高级反馈分析和多版本模型实验明确为延期P2，不阻塞V1；Jev接入取消。
- 11月5日起规划仅修复交付缺陷、安全与文档；11月10日为V1目标，任何规划节点不得当作历史完成事实。

