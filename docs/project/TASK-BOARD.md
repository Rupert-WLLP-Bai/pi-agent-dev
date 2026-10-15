# Contract Audit V1.0 · TASK-BOARD

唯一权威 Master Roadmap。开发周期 **2026-09-11 至 2026-11-10**，V1 截止 **2026-11-10**。总体当前为 **M1 / Phase B**、目标v0.7.0，发布闸门未通过。既有四 Milestone、33项任务原定义保留；旧任务逐ID登记在下方，Execution Inspector是关联M2-B01的子工作包。

当前任务状态使用 TODO、IN_PROGRESS、BLOCKED、DONE、CANCELLED；历史能力分类 IMPLEMENTED/PARTIAL/MISSING/BROKEN/DEFERRED 保留在 [BASELINE](./BASELINE.md)。Owner路径见 [FILE-OWNERSHIP](./FILE-OWNERSHIP.md)，视图切换规则见 [task-management](./task-management.md)。原33项未逐条指定P值，优先级如实记“未记录”；补列模块、阶段依赖和更新日期不改任务验收内容。

## M1 · v0.7.0 · Phase A 设计与实现

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit | 模块 / 总体Milestone | 优先级 / 依赖 | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1-A01 Git接管与保护 | Main / DONE | 当前Git与WIP → 独立分支、精确补丁、变更清单 | 不丢改动、不改历史/Tag/卷；Main Git | 分支release/m1-stabilization-20261015；本机.git两个补丁；接管a849b29 | Git保护 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |
| M1-A02 继承S0/S1与能力分类 | Main / DONE | 既有基线/契约/代码 → 当前能力表 | 每项有代码/测试/限制；Main docs/project/BASELINE.md | S0 d9a84a4；S1验证JSON；当前工作区 | 领域与基线 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |
| M1-A03 环境与依赖检查 | Main、C / DONE | package/lock/Compose → 实测版本与安装记录 | frozen安装、端口与DEV/TEST/DEMO目标可区分；根配置Main、检查脚本C | Bun1.4.3/Node24.19.0/Docker29.8.2/Compose5.5.1；frozen安装425 installs/551 packages，无变化 | 环境依赖 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |
| M1-A04 完整依赖与前后端启动 | Main、C / DONE | 现有Compose与Demo CLI → 正常运行的独立Demo | DB/Redis/S3/dispatcher真实就绪；Main compose.yaml及CLI集成，C后续脚本 | 明确compose.yaml排除override；API13002/Web18080及必需组件通过；真实上传417字节，S3 locator/hash一致 | 服务启动 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |
| M1-A05 已有自动化测试基线 | Main、C / DONE | 现有套件+迁移TEST库 → 原始结果 | 真实执行、区分已知失败；tests与scripts/qa归C | 842pass/0fail/2736expect，87文件31.68s；工作区，非最终release gate | 测试基线 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |
| M1-A06 标准Demo与环境隔离 | Main、C / DONE | 现有seed世界、受管.env → 重复seed/reset与数据核对 | 固定样本/键/预期；保留非Demo；TEST不碰DEV/DEMO；C tests/fixtures与demo脚本，CLI暂Main | ready实跑30.70秒，两次reset各39案件，非Demo哨兵保留并清理，孤儿0；独立TEST库/桶/Redis14及新端口 | Demo数据 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |
| M1-A07 实际缺口与风险登记 | Main / DONE | 本轮实跑 → 仅M1阻塞清单 | 类型、建桶、ready与最终验收缺口可复现；Main docs/project/RISKS.md | RISKS记录实际失败与修复；当前发布闸门仍在执行 | 风险治理 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |
| M1-A08 统一任务板与交接 | Main / DONE | 旧TASK-MATRIX/旧Todo → 本板与HANDOFF | 旧矩阵标历史、不维护平行计划；Main docs/project及历史入口 | TASK-MATRIX与INTEGRATION-CONTRACT旧所有权已标历史并链接本板 | 任务治理 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |
| M1-A09 三Agent所有权与契约 | Main / DONE | 原有已交接切片 → A/B/C边界与公共契约 | 最多三主要Agent、共享文件单Owner；Main契约/FILE-OWNERSHIP | A FrontendIntegrationResume、B DecisionIntegrationResume、C QualityDeliveryResume；当前切片收口 | 任务所有权 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |
| M1-A10 必要修复与整合 | Main、A/B/C / DONE | M1实际阻塞 → 可运行修复 | typed API无掩盖转换、严格S3建桶、ready正确、既有规则不变；按所有权 | typed状态/RuleCode修后typecheck及HTTP18通过；ready/S3/真实PG smoke通过；cleanup独占删除/共享保留回归通过；QA切片冻结 | 集成修复 / M1 | 未记录 / 未单列；见输入/验收列 | 2026-10-15 |

## M1 · v0.7.0 · Phase B 集成、验收与发布

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit | 模块 / 总体Milestone | 优先级 / 依赖 | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1-B01 真实浏览器业务闭环 | Main、A/C / DONE | 独立Demo与标准合同 → 上传、审计、证据、复核、整改、轨迹、原件记录 | 浏览器实际操作、刷新后持久化、S3 locator/hash；A apps/web，C acceptance，Main证据 | [浏览器证明](./evidence/m1/browser.json)：790e61fe上传、双来源证据、5项复核/整改、整改关闭刷新保持、Fake Trace46步、S3重启后读取与同源重新审计通过；不替代全站E2E | 业务闭环 / M1 | 未记录 / M1 Phase A | 2026-10-15 |
| M1-B02 完整Release Gate | Main、B/C / BLOCKED | 冻结候选 → verify、集成/E2E、Web/Docker、迁移、故障、安全结果 | 无阻塞缺陷；新鲜TEST端口/DB；真实Redis/S3；Fake与真实模型分报；按所有权 | 用户要求暂停；本次四层入口失败，报告HTML初始化错误、Playwright混入Bun测试、测试进程未收到S3/Redis配置。两套新TEST库迁移及check:migrations通过；具体结果/路径见HANDOFF暂停断点，尚未修复 | 发布验收 / M1 | 未记录 / M1 Phase A；M1-B01；用户要求继续后解除暂停 | 2026-10-15 |
| M1-B03 发布与交接 | Main / BLOCKED | 通过的候选与证据 → Release Summary、已知问题、提交、v0.7.0 Tag | 检查Tag冲突、不移动旧Tag、版本可回退；Main发布文档/Git | 用户要求暂停，且M1-B02尚未通过；未发布，没有v0.7.0 Tag | 发布交接 / M1 | 未记录 / M1-B02；用户要求继续 | 2026-10-15 |

## M2 · v0.8.0 · Phase A 设计与实现

M1-B03通过后才能开始。现有浅色改版是输入资产，不等于M2完成。

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit | 模块 / 总体Milestone | 优先级 / 依赖 | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M2-A01 双主题设计系统 | A / TODO | 现有Ant/CSS → 默认暗色、完整浅色tokens与组件 | 中文排版、语义色、motion/reduced-motion、真实主题切换；apps/web | 浅色+深色侧栏已存在；默认暗色未做 | 设计系统 / M2 | 未记录 / M1-B03 | 2026-10-15 |
| M2-A02 信息架构与路由 | A / TODO | 当前全部路由 → 六类业务导航、面包屑、状态 | 旧路由兼容、主要动作与加载/错误完整；apps/web | M1后验收 | 信息架构 / M2 | 未记录 / M1-B03 | 2026-10-15 |
| M2-A03 核心工作区 | A、B / TODO | 真实API → Dashboard、队列、三栏证据联动 | 无假统计/响应，上传/筛选/进度/取消/重试/复核可用；web归A、API归B | 既有实现优先复用 | 核心工作区 / M2 | 未记录 / M1-B03 | 2026-10-15 |

## M2 · v0.8.0 · Phase B 集成、验收与发布

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit | 模块 / 总体Milestone | 优先级 / 依赖 | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M2-B01 其余页面一致性 | A / TODO | 复核/整改/治理/运行/设置 → 适合任务的布局 | 不以重复统计卡代替业务；apps/web | [Execution Inspector子工作包](./work-packages/execution-inspector.md)：29项完整保留，准备审计中；父任务仍待总体M2验收 | 其余业务页面 / M2 | 未记录 / M1-B03 | 2026-10-15 |
| M2-B02 交互、主题与响应式 | A、C / TODO | 组件和URL状态 → 键盘/导航、记忆、复制、空错状态 | 1920×1080、1440×900、1024×768、768、375；可减少动效；web归A、测试C | Ctrl+K按现有条件决定，不列无条件阻塞 | 交互与响应式 / M2 | 未记录 / M1-B03 | 2026-10-15 |
| M2-B03 浏览器验收与发布 | Main、A/C / TODO | 双主题候选 → E2E、前后截图、v0.8.0 | 两主题无阻塞溢出/遮挡/不可点击；完整统一闸门；Main文档/发布 | 未发布 | 体验发布 / M2 | 未记录 / M1-B03 | 2026-10-15 |

## M3 · v0.9.0 · Phase A 设计与实现

M2发布后开始；既有默认关闭的决策切片、真实PG和Laya结果保留作为输入。

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit | 模块 / 总体Milestone | 优先级 / 依赖 | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M3-A01 决策公共契约 | Main、B / TODO | S1及已有Provider → 版本化请求/建议/反馈/查询/错误 | Disabled/Fixture/Laya可替换，最小脱敏输入，默认off；契约Main、实现B | 已有实现PARTIAL，待M3合并验收 | 决策契约 / M3 | 未记录 / M2-B03 | 2026-10-15 |
| M3-A02 Laya CPU可行性 | B、C / TODO | 上游许可证/固定模型/60条中文样本 → 中文、结构、路由、冲突、资源和失败报告 | 真实推理与Fake分开；概率不称正确率；scripts/decision与fixtures归C、适配器B | 本轮60/60、macroF1=0.4033/P95=495ms，参考标签；缺完整人工标注/资源口径 | Laya实测 / M3 | 未记录 / M2-B03 | 2026-10-15 |
| M3-A03 Shadow Mode | B / TODO | 既有独立影子任务 → 正式成功后冻结派生、独立建议与反馈 | 不写Finding/规则/复核/案件状态、不执行副作用工具；默认关、故障隔离；apps/api及领域包 | 本轮真实PG/HTTP绑定/幂等/正式行不变已证明，待M3全面闸门 | 影子决策 / M3 | 未记录 / M2-B03 | 2026-10-15 |

## M3 · v0.9.0 · Phase B 集成、验收与发布

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit | 模块 / 总体Milestone | 优先级 / 依赖 | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M3-B01 对照与人工标签评测 | B、C / TODO | 固定规则/Pi/影子输出、标签来源 → 指标/冲突/延迟/错误报告 | 分母、模型、场景、版本明确；无专家签核不称独立人工gold；实现B、fixtures/报告脚本C | 人类标签需真实人员签核，不能由Agent代造 | 决策评测 / M3 | 未记录 / M2-B03 | 2026-10-15 |
| M3-B02 AI建议可视化 | A、B / TODO | 真实Advice/Trace → 来源/版本/类别/概率/冲突/原因/耗时 | 明示shadow与未校准，不把动画当执行；web归A、DTO契约Main | 现有面板复用，待M3 | 建议可视化 / M3 | 未记录 / M2-B03 | 2026-10-15 |
| M3-B03 关闭/兼容/发布 | Main、B/C / TODO | 完成候选或不合格Laya结果 → 回退验证、v0.9.0 | off核心不变且历史可读；Laya不合格则保持关闭、保留公共/Fixture，明确扩展限制；Main发布 | 未发布；Jev可选，未引入远程商业依赖 | 决策发布 / M3 | 未记录 / M2-B03 | 2026-10-15 |

## M4 · v1.0.0 · Phase A 质量工程

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit | 模块 / 总体Milestone | 优先级 / 依赖 | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M4-A01 分层覆盖率 | C / TODO | 全套测试与工具 → 行/函数/分支及分层报告 | 争取核心行/分支80%，不凑数、不相加；工具无分支能力写N/A；tests/scripts归C | 旧Bun LCOV无BRDA，不伪造branch | 分层质量 / M4 | 未记录 / 总体M3；细项未记录 | 2026-10-15 |
| M4-A02 完整E2E与真实模型 | Main、B/C / TODO | 独立TEST全流程 → 文本/PDF/Word、审计/Guard/SSE/复核/整改/治理/存储/降级/决策/刷新/异常证据 | Fake与真实模型分别实测、环境隔离；按所有权 | M1/M2/M3有效证据可复用，注明版本 | 系统验收 / M4 | 未记录 / 总体M3；细项未记录 | 2026-10-15 |
| M4-A03 安全可靠性与性能 | B、C / TODO | 冻结候选+实际负载 → 安全/依赖/性能结果 | 隐私、上传、权限、超时、事务、迁移、并发、决策隔离；带条件和实测值 | 未完成项不得宣称生产就绪 | 安全与性能 / M4 | 未记录 / 总体M3；细项未记录 | 2026-10-15 |
| M4-A04 可复制部署运维 | Main、C / TODO | 现有Compose/env/脚本 → 部署/升级/备份恢复/降级验收 | 另一开发者可照文档复现；备份范围明确；Main根配置/文档、脚本C | 数据库备份不冒充对象存储完整DR | 复制运维 / M4 | 未记录 / 总体M3；细项未记录 | 2026-10-15 |

## M4 · v1.0.0 · Phase B 比赛交付与发布

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit | 模块 / 总体Milestone | 优先级 / 依赖 | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M4-B01 5–8分钟演示 | Main、A/C / TODO | 已验收功能/样本 → 标准路径与故障备用 | 真实接口/日志/耗时，离线Fake明确标识；Main文档、A页面、C数据 | 旧演示资产复用 | 比赛演示 / M4 | 未记录 / 总体M3；细项未记录 | 2026-10-15 |
| M4-B02 全套技术与用户文档 | Main / TODO | 已验证代码/证据 → 架构/需求/使用/运维/竞品/推广文档 | 竞品有来源，规划与实装分开；docs | 既有竞品纠错已交接，待最终版本 | 技术文档 / M4 | 未记录 / 总体M3；细项未记录 | 2026-10-15 |
| M4-B03 真实软件工程过程证明 | Main / TODO | 2026-09-11起Git/提交/验收 → 生命周期/RTM/ADR/WBS/甘特/风险/变更/发布记录 | 计划时间、提交时间、验收时间分列；不把后补文档伪装历史；docs | 2026-11-10前未来仅计划 | 工程证据 / M4 | 未记录 / 总体M3；细项未记录 | 2026-10-15 |
| M4-B04 最终发布 | Main、A/B/C / TODO | 通过全部闸门的候选 → 六份交付文档、v1.0.0 | verify、E2E、Web/Docker/Compose、数据、安全全跑；无阻塞；Main提交/Tag | 截止2026-11-10；未发布 | 最终发布 / M4 | 未记录 / 总体M3；细项未记录 | 2026-10-15 |

## 继承与执行规则

旧[项目矩阵](../project-management/TASK-MATRIX.md)与[工程甘特](../engineering/gantt.md)保留历史；旧ID的当前状态在本板登记，TI明细由本板链接。每次交接同步 [HANDOFF](./HANDOFF.md) 与OMP当前视图；实跑附日期、候选SHA、命令、退出码与限制。发布记录Commit和Tag，代码检查点不等同发布。

## 原任务恢复登记

原53项（17阶段+36工作）的完整名称与顺序已从原会话找回，见[原始todo.init](./recovery/2026-10-15/original-53-todo-init.json)；后续V1、SEC1–SEC6、PI-LIVE为8项明确新增工作。原始描述、验收及矩阵状态另见[矩阵快照](./recovery/2026-10-15/task-matrix.a1e6191.md)和[逐项记录](./recovery/2026-10-15/legacy-before-recovery.json)。本板保存当前登记；Milestone映射为恢复补列，原ID不重编号。

实现层面的“已实现待统一验收”“部分已验证”保留原文并登记IN_PROGRESS；只有对应范围验收闭环才转DONE。父子和关联条目同时保留，不把这些登记数当作独立功能数或完成率。

### 原Q/I/A/F/R工作：36项

| ID | 名称 | 模块 | 所属总体Milestone | 状态 | 优先级 | 依赖 / 验收原文 | 负责人 | 证据 / 原状态 / Commit | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1 | 建立需求—设计—代码—测试—证据 RTM | 质量治理 | M4-B03 | IN_PROGRESS | P0 | 19条均映射到实际回归，不混同golden与独立测试 | QA | [原矩阵第21行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`31bb8d1`）；局部证据不代替完整验收 | 2026-10-15 |
| Q2 | 建立单元、集成和 E2E 分开统计的覆盖率基线 | 质量治理 | M4-A01 | IN_PROGRESS | P0 | 行/函数、集成场景、E2E需求分开统计；不可测分支明确标注 | QA | [原矩阵第22行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`de7ea2d`）；局部证据不代替完整验收 | 2026-10-15 |
| Q3 | 完善领域、数据库、存储、缓存、SSE、密钥及 UI 行为测试 | 系统回归 | M1-B02；M4-A02 | IN_PROGRESS | P0 | 复用现有fakes与隔离PG，新增行为测试 | QA | [原矩阵第23行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`de7ea2d`、`f7ce8d1`）；局部证据不代替完整验收 | 2026-10-15 |
| Q4 | 提供规范测试入口与可追溯机器报告 | 验证入口 | M1-B02；M4-A01 | IN_PROGRESS | P0 | 保留原命令，新增可运行入口与SHA/退出码 | QA | [原矩阵第24行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`de7ea2d`）；局部证据不代替完整验收 | 2026-10-15 |
| Q5 | 扩充 CI 的 Redis/RustFS 验证与工件归档 | 持续集成 | M4-A01 | IN_PROGRESS | P0 | 不使用外部LLM凭证；机器摘要、LCOV与失败工件可归档 | QA | [原矩阵第25行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`de7ea2d`）；局部证据不代替完整验收 | 2026-10-15 |
| Q6 | 完善模型、存储、缓存、重复操作和上传失败回归 | 故障回归 | M1-B02 | IN_PROGRESS | P0 | 故障明确，正式审计不受影子失败污染 | QA | [原矩阵第26行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`de7ea2d`）；局部证据不代替完整验收 | 2026-10-15 |
| I1 | 核对并改进 Compose、版本、端口、健康检查与持久化 | 基础设施 | M1-A04；M4-A04 | IN_PROGRESS | P0 | 可复制本机配置，区分demo与生产设置 | Infra | [原矩阵第32行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`908cb5a`）；局部证据不代替完整验收 | 2026-10-15 |
| I2 | 验证 Amazon S3 接口与 RustFS 原件完整读写链路 | 原件存储 | M1-B02 | IN_PROGRESS | P0 | 原字节hash一致、错误不伪报写入成功 | Infra | [原矩阵第33行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`908cb5a`）；局部证据不代替完整验收 | 2026-10-15 |
| I3 | 实现限定 demo 归属的安全、可重试、幂等重置 | Demo隔离 | M1-A06 | IN_PROGRESS | P0 | 保留非demo记录，重复结果一致，禁止全库清空 | Infra | [原矩阵第34行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`908cb5a`+`a849b29`）；局部证据不代替完整验收 | 2026-10-15 |
| I4 | 提供 demo-up、demo-reset、demo-check、demo-down | 环境CLI | M1-A04；M4-A04 | IN_PROGRESS | P0 | 四入口可运行、可诊断、可停止自建服务 | Infra | [原矩阵第35行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`908cb5a`+Infra收尾）；局部证据不代替完整验收 | 2026-10-15 |
| I5 | 建立并验证 S3、Redis、Pi、Laya、Postgres 降级矩阵 | 依赖故障 | M1-B02 | IN_PROGRESS | P0 | 真实依赖异常与恢复；PG失败明确；Laya不影响正式结果 | Infra + QA | [原矩阵第36行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`908cb5a`、`de7ea2d`）；局部证据不代替完整验收 | 2026-10-15 |
| I6 | 完善配置、部署、权限说明及备份恢复演练 | 部署运维 | M4-A04 | IN_PROGRESS | P0 | 不打印密钥，文档命令与实测一致，恢复只进新测试库 | Infra | [原矩阵第37行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`908cb5a`）；局部证据不代替完整验收 | 2026-10-15 |
| I7 | 提供 minimal 与 full/optional 两种可复现演示模式 | 环境Profile | M1-A04；M4-A04 | IN_PROGRESS | P0 | minimal无模型密钥；optional显式启用；记录真实启动耗时 | Infra | [原矩阵第38行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`908cb5a`）；局部证据不代替完整验收 | 2026-10-15 |
| A0 | 核实 Laya/Jev 并实际验证本地 CPU 中文推理条件 | Laya实测 | M3-A02 | DONE | P0 | 固定代码/模型revision，CPU真实smoke；无法运行则提供具体阻塞 | AI + Main | [原矩阵第44行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：部分实现（冒烟已验证；全量评测待S3）；原OMP已于05:11完成本地CPU冒烟（bf74b1f1、cd24aac），该DONE保留；Jev子范围取消。60条/完整评测、资源及专家标签的新增门禁仍由M3-A02/M3-B01追踪 | 2026-10-15 |
| A1 | 实现独立、受约束的 DecisionProvider Interface | 决策契约 | M3-A01 | IN_PROGRESS | P0 | S1固定Interface；不更改AuditAgentPort职责 | AI | [原矩阵第45行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`a6ec041`）；局部证据不代替完整验收 | 2026-10-15 |
| A2 | 实现 Disabled/Fake、LayaCpu 与默认禁用的可选 Jev Adapter | 决策适配器 | M3-A01 | IN_PROGRESS | P0 | off不调用；仅受控本地origin；无Jev、无远程决策密钥；错误不伪造答案 | AI | [原矩阵第46行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`a6ec041`）；局部证据不代替完整验收 | 2026-10-15 |
| A3 | 实现 DECISION_MODE=off\|shadow 与主结论零副作用 | 影子隔离 | M3-A03 | IN_PROGRESS | P0 | 默认off；影子不写Finding、规则、人工审批或工具命令 | AI | [原矩阵第47行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`a6ec041`）；局部证据不代替完整验收 | 2026-10-15 |
| A4 | 建立至少 60 条中文合成条款及可追溯标签说明 | 决策数据集 | M3-A02 | IN_PROGRESS | P1 | 覆盖十类、否定/例外/模糊/跨条款；如无专家签核必须标开发标签 | AI | [原矩阵第48行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`a6ec041`）；局部证据不代替完整验收 | 2026-10-15 |
| A5 | 实现公平评测和实际质量、校准、延迟、资源报告 | 决策评测 | M3-B01 | IN_PROGRESS | P1 | 固定输入与Pi输出，记录F1/P/R/混淆/拒判/p50/p95/资源；未跑路径不填数 | AI + Main | [原矩阵第49行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`a6ec041`）；局部证据不代替完整验收 | 2026-10-15 |
| A6 | 持久化影子差异、冲突和模型版本，支持独立恢复与关闭 | 影子持久化 | M3-A03 | IN_PROGRESS | P1 | 冻结准确输入身份、独立扫描、幂等、有界重试，保持正式状态 | AI + Main | [原矩阵第50行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`a6ec041`、`f7ce8d1`）；局部证据不代替完整验收 | 2026-10-15 |
| A7 | 提供脱敏只读决策详情与保留/权限策略 | 决策治理 | M3-A03；M3-B02 | IN_PROGRESS | P1 | 与UI同一DTO；不暴露密钥、完整原文或提示词 | AI | [原矩阵第51行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`a6ec041`+未提交修订）；局部证据不代替完整验收 | 2026-10-15 |
| A8 | 实现独立人工反馈事件及原规则/Guard 不变回归 | 反馈隔离 | M3-A03；M3-B01 | IN_PROGRESS | P1 | append-only反馈独立于Finding Review；19规则/Guard不变 | AI + QA | [原矩阵第52行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`a6ec041`）；局部证据不代替完整验收 | 2026-10-15 |
| F1 | 实测上传至整改的操作路径、问题和对照截图 | 业务走查 | M1-B01；M2-A03 | IN_PROGRESS | P1 | 相同合成数据的前后截图、操作步骤与失败依据 | UX + Main | [原矩阵第58行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`cc942b2`）；局部证据不代替完整验收 | 2026-10-15 |
| F2 | 复用现有 React/Ant Design 规范并统一展示样式 | 设计体系 | M2-A01 | IN_PROGRESS | P1 | 小步一致性，不迁移框架 | UX | [原矩阵第59行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`cc942b2`）；局部证据不代替完整验收 | 2026-10-15 |
| F3 | 改进队列、证据定位、风险分组和运行/复核/整改状态 | 业务工作区 | M2-A03 | IN_PROGRESS | P1 | 改实际缺口，保持证据链与状态清楚 | UX + QA | [原矩阵第60行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`cc942b2`）；局部证据不代替完整验收 | 2026-10-15 |
| F4 | 接入真实决策详情，明确来源、未校准与影子建议 | 决策可视化 | M3-B02 | IN_PROGRESS | P1 | S1 DTO→真实API；辅助意见不伪装正式结论 | UX | [原矩阵第61行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`cc942b2`）；局部证据不代替完整验收 | 2026-10-15 |
| F5 | 验证键盘、标签、错误提示及桌面尺寸适配 | 可访问性 | M2-B02 | IN_PROGRESS | P1 | 实测键盘/label/焦点，1440×900与1920×1080，无正式认证声称 | UX | [原矩阵第62行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`cc942b2`）；局部证据不代替完整验收 | 2026-10-15 |
| F6 | 补充用户行为验收、前后截图与实际加载指标 | 浏览器验收 | M2-B03 | IN_PROGRESS | P1 | role/label定位、真实运行，未测不报提升比例 | UX + QA | [原矩阵第63行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`cc942b2`）；局部证据不代替完整验收 | 2026-10-15 |
| R1 | 以真实 Git 历史生成 WBS、里程碑与未来计划甘特图 | 工程过程 | M4-B03 | IN_PROGRESS | P1 | 每个历史节点有真实SHA，未来到11-10明确标规划 | Docs | [原矩阵第75行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`31bb8d1`）；局部证据不代替完整验收 | 2026-10-15 |
| R2 | 完成 SRS-lite、架构、流程、ADR 与非功能需求证据 | 技术文档 | M4-B02 | IN_PROGRESS | P1 | 复用现有资料，对需求与代码、测试可追踪 | Docs | [原矩阵第76行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`31bb8d1`）；局部证据不代替完整验收 | 2026-10-15 |
| R3 | 校对 README、架构、命令、组件和功能状态 | 文档一致性 | M4-B02 | IN_PROGRESS | P1 | 改为当前实际能力，运行命令实际有效 | Docs | [原矩阵第77行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`31bb8d1`）；局部证据不代替完整验收 | 2026-10-15 |
| R4 | 以官方来源完成竞品与开源对照 | 竞品研究 | M4-B02 | IN_PROGRESS | P1 | 本轮补核官方来源、访问日期、部署/隐私/证据/成本局限 | Docs | [原矩阵第78行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`31bb8d1`）；局部证据不代替完整验收 | 2026-10-15 |
| R5 | 将自主工程模块、隐私和部署能力映射到创新证据 | 自主创新 | M4-B02 | IN_PROGRESS | P1 | 区分自主工程与第三方基础模型、每项有代码/演示证据 | Docs | [原矩阵第79行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`31bb8d1`）；局部证据不代替完整验收 | 2026-10-15 |
| R6 | 完成可离线复现的 7–10 分钟演示脚本 | 比赛演示 | M4-B01 | IN_PROGRESS | P1 | health→安全reset→合成合同→审计复核→可用影子→trace/S3→测试→复制 | Docs | [原矩阵第80行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`31bb8d1`；命令核对进行中）；局部证据不代替完整验收 | 2026-10-15 |
| R7 | 完成有证据的评委 FAQ | 答辩FAQ | M4-B02 | IN_PROGRESS | P1 | 问答均有实际约束与依据 | Docs | [原矩阵第81行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`31bb8d1`）；局部证据不代替完整验收 | 2026-10-15 |
| R8 | 定义 KPI 与测量方法并区分未测指标 | 指标证据 | M4-B03 | IN_PROGRESS | P1 | 未测指标只写测量计划，不编造生产收益 | Docs | [原矩阵第82行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`31bb8d1`）；局部证据不代替完整验收 | 2026-10-15 |

### 后续明确新增工作：8项

| ID | 名称 | 模块 | 所属总体Milestone | 状态 | 优先级 | 依赖 / 验收原文 | 负责人 | 证据 / 原状态 / Commit | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | 全站视觉重设计（用户显式请求）：React19+AntD6/TanStack桌面web；企业SaaS专业浅色方向（navy `#0F172A`、blue `#0369A1`、light `#F8FAFC`、white表面、slate `#475569`次级、语义风险色）；保留中文UI、现有路由与真实API数据、Ant自带图标与本地中文字体；不新增UI框架/外部字体/GSAP/图标依赖；CSS tokens与Ant主题对齐；键盘焦点可见、reduced motion；不做dark mode | 全站视觉 | M2-A01；M2-A03 | IN_PROGRESS | P1 | 桌面留白与层级实质改善；375/1280/1440/1920四档视口+键盘操作通过Playwright并留存截图；375px面板控制不回退 | VisualRedesign | [原矩阵第69行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：实施中；局部证据不代替完整验收 | 2026-10-15 |
| SEC1 | 替换演示凭据、密钥重封装/轮换、部署访问保护 | 密钥与访问 | M1-B02；M4-A03 | IN_PROGRESS | P0 | I1、I6、统一访问门禁 | Main + Infra | [原矩阵第92行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：部分已验证：轮换实测`key-rotation-smoke.json`、启动重封`startup-security.json`（`cd24aac`）；部署侧待S3统一验收；局部证据不代替完整验收 | 2026-10-15 |
| SEC2 | 上传大小/格式、路径穿越、异常PDF/DOCX与存储归属 | 上传边界 | M1-B02；M4-A03 | IN_PROGRESS | P0 | I2、Q3 | Infra + QA | [原矩阵第93行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`908cb5a`）：行为测试+`storage-boundary-smoke.json`实测；局部证据不代替完整验收 | 2026-10-15 |
| SEC3 | 审计、原件、SSE及影子详情服务端授权 | 服务端授权 | M1-B02 | IN_PROGRESS | P0 | S1访问口令契约 | Main + UX + QA | [原矩阵第94行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已验证（HTTP层）：[s2-security](../project-management/evidence/s2-security.json)（匿名401/授权200/登出204/重放401，`1f33d99`）+ SSE吊销（`b2033e1`）；影子详情授权待S3回归；局部证据不代替完整验收 | 2026-10-15 |
| SEC4 | 模型最小脱敏输入与外部真实合同出网默认禁止 | 模型出网 | M4-A03 | IN_PROGRESS | P0 | A1–A3、模型origin策略 | Main + AI + QA | [原矩阵第95行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收：策略代码+守卫（`b2033e1`）；字段级抓包待QA归集；局部证据不代替完整验收 | 2026-10-15 |
| SEC5 | 脱敏访问日志、读取限制与影子保留/清理 | 数据治理 | M4-A03 | IN_PROGRESS | P0 | A6–A8、SEC3 | Main + AI | [原矩阵第96行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`a6ec041`）：保留期路由+脱敏DTO测试；局部证据不代替完整验收 | 2026-10-15 |
| SEC6 | 明确存储降级及敏感数据持久化边界 | 存储降级 | M1-B02 | IN_PROGRESS | P0 | I2、I5 | Infra + QA | [原矩阵第97行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：已实现待统一验收（`908cb5a`）：strict/local语义+health实际后端；局部证据不代替完整验收 | 2026-10-15 |
| PI-LIVE | 指定本地DeepSeek网关真实Pi合成合同审计 | 真实Pi验证 | M4-A02；M1-B02 | DONE | P0 | S1、真实provider配置、服务健康 | Main | [原矩阵第98行](../project-management/TASK-MATRIX.md)，a1e6191；原状态：部分已验证：单合成样本两次实测[real-pi-smoke](../project-management/evidence/real-pi-smoke.json)（29727/30365 ms、Guard通过、快照不可变）；全流程真实验证待S3；原OMP已于05:11完成指定网关合成合同真实Pi验证（bf74b1f1），保留DONE；全量端到端发布门禁属于M4-A02/M1-B02，仍待完成 | 2026-10-15 |

### 历史子范围与验收清单

- Jev接入：历史明确取消（原矩阵第44、104行），仅该子范围为CANCELLED；不取消A0或可插拔DecisionProvider。总体M3-B03所说“Jev可选”保留为扩展说明，不把已取消接入重新标TODO。
- 置信度校准研究、高级反馈分析、多版本模型实验：历史明确延期P2，原矩阵第104行；不伪装已实施，也不据此缩小A7/A8现有验收。原来源未逐项编号，保留为范围说明，不杜撰原任务ID。
- G1–G7是S1验收子清单，曾在OMP中显式登记并完成。下表保留原ID和DONE，不当作另七个独立功能；后续S2/S3运行验收仍归对应任务。
- V1原请求为浅色视觉重设计；总体M2后续明确要求双主题。两次要求及各自验收保留，完成旧浅色改版不等于完成新双主题。


### 原阶段控制任务：17项

名称逐字取自[原53项初始化](./recovery/2026-10-15/original-53-todo-init.json)，不是按编号重建。S0/S1九项DONE保留；S3/S4历史TODO与当前依据分别写明。原init未逐项记录优先级、独立描述或依赖：原任务名称保留为说明，P值记“未记录”；表中依赖是依据旧矩阵阶段顺序与验收条件补列的当前执行关系，不能冒充原始字段。S2后续改名和Jev范围调整见[变更调用](./recovery/2026-10-15/original-task-changes.json)。

| ID | 名称 | 模块 | 所属总体Milestone | 状态 | 优先级 | 依赖 / 验收原文 | 负责人 | 证据 / 原状态 / Commit | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S0.1 | 记录基线 SHA、Git 历史与 Bun/Node/Docker 版本 | 阶段控制 | M1-A01；M1-A03 | DONE | 未记录 | 未记录 | Main | d9a84a4基线；原todo.done dde12204；BASELINE；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S0.2 | 五个 Subagent 只读审计现有代码、文档、测试与未完成事项 | 阶段控制 | M1-A02 | DONE | 未记录 | 未记录 | Main + 五scout | 五份只读审计；原批量done e1e4db62；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S0.3 | 验证依赖、Compose、迁移及现有自动化验收 | 阶段控制 | M1-A03；M1-A05 | DONE | 未记录 | 未记录 | Main | 原批量done c6fa2748；基线652/0、验收37/1，记录旧失败不等于全绿；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S0.4 | 启动独立演示前后端并验证 health 与真实请求 | 阶段控制 | M1-A04 | DONE | 未记录 | 未记录 | Main | 原批量done6d628462；独立API3302/Web5302、health与真实请求；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S0.5 | 建立 BASELINE、TASK-MATRIX 和 RISKS 证据文档 | 阶段控制 | M1-A07；M1-A08 | DONE | 未记录 | 未记录 | Main | 原批量done e1e4db62；旧BASELINE/TASK-MATRIX/RISKS保留；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S0.6 | 完成安全检查并提交 S0 | 阶段控制 | M1-A01；M1-A07 | DONE | 未记录 | 未记录 | Main | 原todo.done21c6d915；S0审计提交a4c6119；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S1.1 | 锁定 DecisionRequest、DecisionAdvice、反馈与查询公共契约 | 阶段控制 | M1-A09；M3-A01 | DONE | 未记录 | S0 | Main | 原批量done bb49a195；S1契约6a59906、18项契约回归；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S1.2 | 锁定默认关闭、影子隔离、隐私、迁移与文件所有权 | 阶段控制 | M1-A09；M3-A03 | DONE | 未记录 | S0 | Main | 原批量done bb49a195；G1–G7与共享Owner冻结；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S1.3 | 发布 INTEGRATION-CONTRACT 并提交 S1 | 阶段控制 | M1-A09 | DONE | 未记录 | S1.1、S1.2及G1–G7 | Main | 原批量done05ce5fa4；6a59906、s1-verification.json；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S2 | 集成五个 Agent 实现、执行 smoke 并提交 S2 | 阶段控制 | M1-A10；M1-B02；M2；M3 | IN_PROGRESS | 未记录 | S1 | 五Agent + Main | 原名后续改为“按独立纵向切片持续合并与回归”；phase曾被rm清空，未记录整体DONE；a6ec041/908cb5a/cc942b2/de7ea2d/31bb8d1等已合并，统一验收未结束；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S3.1 | 执行 lint、typecheck、单元、数据库集成与覆盖率 | 阶段控制 | M1-B02；M4-A01 | IN_PROGRESS | 未记录 | S2 | Main + QA | 历史末次面板IN_PROGRESS；verify841/0已通过，独立集成及四层统一报告待完成；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S3.2 | 执行真实浏览器 E2E、Docker、S3/Redis 故障及两次 reset | 阶段控制 | M1-B01；M1-B02 | IN_PROGRESS | 未记录 | S2 | Main + QA | 历史末次TODO；本轮按浏览器/S3重启/rerun、Docker、两次reset部分证据更新进行中；全E2E/故障未完成；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S3.3 | 验证 feature flag 与迁移兼容回滚方案 | 阶段控制 | M3-B03；M4-A04 | TODO | 未记录 | S2 | Main + QA | 历史末次TODO；off与真实PG局部smoke已记录，迁移兼容/回退完整门禁未执行；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S3.4 | 发布 RELEASE-READINESS 与实际结果并提交 S3 | 阶段控制 | M1-B03；M4-B04 | TODO | 未记录 | S3.1–S3.3 | Main + QA | 历史末次TODO；未发布RELEASE-READINESS及S3阶段验收；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S4.1 | 汇总五 Agent、提交、变更、截图、测试与 Demo 证据 | 阶段控制 | M4-B02；M4-B03 | IN_PROGRESS | 未记录 | S3 | Main + Docs | 历史末次TODO；31bb8d1工程/竞赛文档及后续浏览器证据已入树，汇总未结束；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S4.2 | 完成交付索引、独立复现、风险和截至 11 月 10 日计划 | 阶段控制 | M4-A04；M4-B02；M4-B03 | IN_PROGRESS | 未记录 | S3 | Main + Docs | 历史末次TODO；工程Gantt与风险/索引已有，独立复现和最终交付未验收；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |
| S4.3 | 提交 S4 并按指定格式交付真实总结 | 阶段控制 | M4-B04 | TODO | 未记录 | S4.1、S4.2 | Main | 历史末次TODO；未形成S4最终发布/交付；[原始调用与变更](./recovery/2026-10-15/original-task-changes.json) | 2026-10-15 |


### 历史验收子项与名称变更：8项

这些记录保留曾在OMP中出现的ID和完成状态；G1–G7归S1，A2-P0是A2移除Jev子范围后的名称，均不增加独立产品功能。具体原始名称变更与完成调用见[变更记录](./recovery/2026-10-15/original-task-changes.json)。

| ID | 名称 | 模块 | 所属总体Milestone | 状态 | 优先级 | 依赖 / 验收原文 | 负责人 | 证据 / 原状态 / Commit | 最近更新 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | 为跨 Agent DTO 增加 Schema 版本、错误模型与契约测试 | S1验收子清单 | M1-A09 | DONE | 未记录 | S0；S1.1、S1.2 | Main | 原append252d86a3、原done bb49a195；6a59906及18项契约回归；不替代S2/S3运行验收 | 2026-10-15 |
| G2 | 明确 Shadow 只读边界及正式 Finding 不变量 | S1验收子清单 | M1-A09 | DONE | 未记录 | S0；S1.1、S1.2 | Main | 原append252d86a3、原done bb49a195；6a59906及18项契约回归；不替代S2/S3运行验收 | 2026-10-15 |
| G3 | 明确脱敏、服务端授权、留存和删除策略 | S1验收子清单 | M1-A09 | DONE | 未记录 | S0；S1.1、S1.2 | Main | 原append252d86a3、原done bb49a195；6a59906及18项契约回归；不替代S2/S3运行验收 | 2026-10-15 |
| G4 | 明确唯一迁移负责人、兼容和回滚方案 | S1验收子清单 | M1-A09 | DONE | 未记录 | S0；S1.1、S1.2 | Main | 原append252d86a3、原done bb49a195；6a59906及18项契约回归；不替代S2/S3运行验收 | 2026-10-15 |
| G5 | 明确 Laya CPU 中文实测与失败降级路径 | S1验收子清单 | M1-A09 | DONE | 未记录 | S0；S1.1、S1.2 | Main | 原append252d86a3、原done bb49a195；6a59906及18项契约回归；不替代S2/S3运行验收 | 2026-10-15 |
| G6 | 为每项任务标注优先级、Owner、依赖、工作量和验收证据 | S1验收子清单 | M1-A09 | DONE | 未记录 | S0；S1.1、S1.2 | Main | 原append252d86a3、原done bb49a195；6a59906及18项契约回归；不替代S2/S3运行验收 | 2026-10-15 |
| G7 | 建立五个独立 worktree 及持续合并回归机制 | S1验收子清单 | M1-A09 | DONE | 未记录 | S0；S1.1、S1.2 | Main | 原append252d86a3、原done bb49a195；6a59906及18项契约回归；不替代S2/S3运行验收 | 2026-10-15 |
| A2-P0 | 实现 Disabled/Fake 与 LayaCpu Adapter | A2范围变更记录 | M3-A01 | IN_PROGRESS | P0 | S1；关联A2 | AI | 原append252d86a3；a6ec041已实现待统一验收；原A2仍保留，Jev子范围CANCELLED | 2026-10-15 |

### 原无编号的执行操作与延期范围

下列操作保留原名称和可确认的历史状态，按归属跟踪，不给原无编号记录补造“原任务ID”。这不是第二份当前任务板。其原始参数/时间与七项续作视图均已保存在[变更记录](./recovery/2026-10-15/original-task-changes.json)。

| 原名称 | 已确认历史状态 / 来源 | 当前归属 |
| --- | --- | --- |
| Main 完成共享口令会话门禁与模型出网策略并实测提交 | DONE，c8bc1fc4 / 1f33d99 | SEC3、SEC4 |
| Main 完成模型/OCR密钥原子轮换与安全启动验证 | DONE，bf74b1f1 / cd24aac | SEC1 |
| 修复真实主体核验失败绕过合成合同出网限制并验证 | DONE，5302180a / b2033e1 | SEC4 |
| 修复登出或过期后已建立 SSE 连接继续推送并验证 | DONE，5302180a / b2033e1 | SEC3 |
| 移除 Jev 接入范围，仅保留 Disabled/Fake 与本地 Laya | DONE，bb49a195；Jev子范围取消 | S1.2、A0、A2 |
| 恢复决策子任务，完成路由契约、SQL 持久化与正式链路集成 | DONE，ca545daa；不能替代M3完整发布 | M1-A10、A6–A8 |
| 恢复前端子任务，完成 typed API、会话与工作流联调 | 曾BLOCKED等Agent结果，7e71d7fc；后续typed修复见M1-A10；未另造历史done调用 | M1-A10、F3 |
| 恢复基础设施子任务，完成受管演示入口和备份恢复 | 原七项续作视图中保留，未找到单独done调用 | I4、I6 |
| 恢复 QA 子任务，完成分层报告、故障与浏览器验收 | 原七项续作视图中保留，未找到单独done调用 | Q2–Q6、M1-B02 |
| 恢复文档子任务，更新任务矩阵和实际交付证据 | 原七项续作视图中保留，未找到单独done调用 | R1–R8、M4-B02 |
| 新增视觉 Agent，按 ui-ux-pro-max 重设计网站样式 | 原七项续作视图中保留 | V1、M2 |
| 保持 API/Web 热更新运行，完成集成验证并交付可用网站 | 原七项续作视图中保留，最终交付仍须发布闸门 | M1-A04、M1-B02、M1-B03 |
| P2 可延期：完整置信度校准研究 | BLOCKED，252d86a3；用户明确延期P2、不阻塞V1 | A5关联、11月10日后路线图 |
| P2 可延期：高级决策反馈分析 | BLOCKED，252d86a3；用户明确延期P2、不阻塞V1 | A8关联、11月10日后路线图 |
| P2 可延期：多版本模型实验 | BLOCKED，252d86a3；用户明确延期P2、不阻塞V1 | A5关联、11月10日后路线图 |

### 规格及原始范围索引

[原V1规格归并Backlog](../design/2026-10-15-v1-implementation-backlog.md)保留优化、RustFS、Demo、Agent、推广、竞品、工程治理和竞赛交付的需求映射；它是历史规格来源，静态未勾选项不被解读为当前实现缺失或当前完成。19条规则、Pi工具/Guard、证据坐标、RustFS/S3和可重复演示仍在项目范围内，TI页面重构不缩小这些工作。

## 当前执行视图

OMP保留M1-B01完成、M1-B02与M1-B03因用户要求暂停而BLOCKED，以及暂停的M2-B01/TI工作包入口。恢复断点见[HANDOFF](./HANDOFF.md)；用户要求继续后解除暂停。临时REC操作保存在[恢复记录](./recovery/2026-10-15/README.md)。TI原29项仍为DONE 1 / IN_PROGRESS 1 / TODO 27，不因入口暂停而改变。

登记口径：原53项 + 后增8项 + 四Milestone33项 + TI29项 = **123条主任务记录**；另有G1–G7和A2-P0共**8条历史验收/名称变更记录**。不同层级有关联和重叠，不据此计算产品完成率。原无编号的操作、延期范围及REC恢复步骤单列保留。

