# Contract Audit V1.0 · TASK-BOARD

唯一权威任务板。当前：**M1 / Phase B**，目标v0.7.0；实现已冻结，发布闸门未通过，不进入正式M2。依据为2026-10-15用户Milestone Master Plan；历史S0/S1及五切片成果复用，不重做已通过工作。

状态仅使用TODO、IN_PROGRESS、BLOCKED、DONE、DEFERRED。能力分类IMPLEMENTED/PARTIAL/MISSING/BROKEN/DEFERRED见[BASELINE](./BASELINE.md)。所有Owner的精确路径边界见[FILE-OWNERSHIP](./FILE-OWNERSHIP.md)。记录“工作区”表示尚无对应发布提交，不能当成版本完成时间。

## M1 · v0.7.0 · Phase A 设计与实现

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit |
| --- | --- | --- | --- | --- |
| M1-A01 Git接管与保护 | Main / DONE | 当前Git与WIP → 独立分支、精确补丁、变更清单 | 不丢改动、不改历史/Tag/卷；Main Git | 分支release/m1-stabilization-20261015；本机.git两个补丁；接管a849b29 |
| M1-A02 继承S0/S1与能力分类 | Main / DONE | 既有基线/契约/代码 → 当前能力表 | 每项有代码/测试/限制；Main docs/project/BASELINE.md | S0 d9a84a4；S1验证JSON；当前工作区 |
| M1-A03 环境与依赖检查 | Main、C / DONE | package/lock/Compose → 实测版本与安装记录 | frozen安装、端口与DEV/TEST/DEMO目标可区分；根配置Main、检查脚本C | Bun1.4.3/Node24.19.0/Docker29.8.2/Compose5.5.1；frozen安装425 installs/551 packages，无变化 |
| M1-A04 完整依赖与前后端启动 | Main、C / DONE | 现有Compose与Demo CLI → 正常运行的独立Demo | DB/Redis/S3/dispatcher真实就绪；Main compose.yaml及CLI集成，C后续脚本 | 明确compose.yaml排除override；API13002/Web18080及必需组件通过；真实上传417字节，S3 locator/hash一致 |
| M1-A05 已有自动化测试基线 | Main、C / DONE | 现有套件+迁移TEST库 → 原始结果 | 真实执行、区分已知失败；tests与scripts/qa归C | 842pass/0fail/2736expect，87文件31.68s；工作区，非最终release gate |
| M1-A06 标准Demo与环境隔离 | Main、C / DONE | 现有seed世界、受管.env → 重复seed/reset与数据核对 | 固定样本/键/预期；保留非Demo；TEST不碰DEV/DEMO；C tests/fixtures与demo脚本，CLI暂Main | ready实跑30.70秒，两次reset各39案件，非Demo哨兵保留并清理，孤儿0；独立TEST库/桶/Redis14及新端口 |
| M1-A07 实际缺口与风险登记 | Main / DONE | 本轮实跑 → 仅M1阻塞清单 | 类型、建桶、ready与最终验收缺口可复现；Main docs/project/RISKS.md | RISKS记录实际失败与修复；当前发布闸门仍在执行 |
| M1-A08 统一任务板与交接 | Main / DONE | 旧TASK-MATRIX/旧Todo → 本板与HANDOFF | 旧矩阵标历史、不维护平行计划；Main docs/project及历史入口 | TASK-MATRIX与INTEGRATION-CONTRACT旧所有权已标历史并链接本板 |
| M1-A09 三Agent所有权与契约 | Main / DONE | 原有已交接切片 → A/B/C边界与公共契约 | 最多三主要Agent、共享文件单Owner；Main契约/FILE-OWNERSHIP | A FrontendIntegrationResume、B DecisionIntegrationResume、C QualityDeliveryResume；当前切片收口 |
| M1-A10 必要修复与整合 | Main、A/B/C / DONE | M1实际阻塞 → 可运行修复 | typed API无掩盖转换、严格S3建桶、ready正确、既有规则不变；按所有权 | typed状态/RuleCode修后typecheck及HTTP18通过；ready/S3/真实PG smoke通过；cleanup独占删除/共享保留回归通过；QA切片冻结 |

## M1 · v0.7.0 · Phase B 集成、验收与发布

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit |
| --- | --- | --- | --- | --- |
| M1-B01 真实浏览器业务闭环 | Main、A/C / IN_PROGRESS | 独立Demo与标准合同 → 上传、审计、证据、复核、整改、轨迹、原件记录 | 浏览器实际操作、刷新后持久化、S3 locator/hash；A apps/web，C acceptance，Main证据 | 案件790e61fe已上传、证据定位、5项复核完成；5个整改已生成，关闭/轨迹验收中 |
| M1-B02 完整Release Gate | Main、B/C / IN_PROGRESS | 冻结候选 → verify、集成/E2E、Web/Docker、迁移、故障、安全结果 | 无阻塞缺陷；新鲜TEST端口/DB；真实Redis/S3；Fake与真实模型分报；按所有权 | Web构建15.48秒通过；独立E2E迁移通过；首轮lint9错误已修，verify重新执行中，其余不得提前标绿 |
| M1-B03 发布与交接 | Main / TODO | 通过的候选与证据 → Release Summary、已知问题、提交、v0.7.0 Tag | 检查Tag冲突、不移动旧Tag、版本可回退；Main发布文档/Git | 未发布；当前HEAD a849b29 |

## M2 · v0.8.0 · Phase A 设计与实现

M1-B03通过后才能开始。现有浅色改版是输入资产，不等于M2完成。

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit |
| --- | --- | --- | --- | --- |
| M2-A01 双主题设计系统 | A / TODO | 现有Ant/CSS → 默认暗色、完整浅色tokens与组件 | 中文排版、语义色、motion/reduced-motion、真实主题切换；apps/web | 浅色+深色侧栏已存在；默认暗色未做 |
| M2-A02 信息架构与路由 | A / TODO | 当前全部路由 → 六类业务导航、面包屑、状态 | 旧路由兼容、主要动作与加载/错误完整；apps/web | M1后验收 |
| M2-A03 核心工作区 | A、B / TODO | 真实API → Dashboard、队列、三栏证据联动 | 无假统计/响应，上传/筛选/进度/取消/重试/复核可用；web归A、API归B | 既有实现优先复用 |

## M2 · v0.8.0 · Phase B 集成、验收与发布

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit |
| --- | --- | --- | --- | --- |
| M2-B01 其余页面一致性 | A / TODO | 复核/整改/治理/运行/设置 → 适合任务的布局 | 不以重复统计卡代替业务；apps/web | 待M2 |
| M2-B02 交互、主题与响应式 | A、C / TODO | 组件和URL状态 → 键盘/导航、记忆、复制、空错状态 | 1920×1080、1440×900、1024×768、768、375；可减少动效；web归A、测试C | Ctrl+K按现有条件决定，不列无条件阻塞 |
| M2-B03 浏览器验收与发布 | Main、A/C / TODO | 双主题候选 → E2E、前后截图、v0.8.0 | 两主题无阻塞溢出/遮挡/不可点击；完整统一闸门；Main文档/发布 | 未发布 |

## M3 · v0.9.0 · Phase A 设计与实现

M2发布后开始；既有默认关闭的决策切片、真实PG和Laya结果保留作为输入。

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit |
| --- | --- | --- | --- | --- |
| M3-A01 决策公共契约 | Main、B / TODO | S1及已有Provider → 版本化请求/建议/反馈/查询/错误 | Disabled/Fixture/Laya可替换，最小脱敏输入，默认off；契约Main、实现B | 已有实现PARTIAL，待M3合并验收 |
| M3-A02 Laya CPU可行性 | B、C / TODO | 上游许可证/固定模型/60条中文样本 → 中文、结构、路由、冲突、资源和失败报告 | 真实推理与Fake分开；概率不称正确率；scripts/decision与fixtures归C、适配器B | 本轮60/60、macroF1=0.4033/P95=495ms，参考标签；缺完整人工标注/资源口径 |
| M3-A03 Shadow Mode | B / TODO | 既有独立影子任务 → 正式成功后冻结派生、独立建议与反馈 | 不写Finding/规则/复核/案件状态、不执行副作用工具；默认关、故障隔离；apps/api及领域包 | 本轮真实PG/HTTP绑定/幂等/正式行不变已证明，待M3全面闸门 |

## M3 · v0.9.0 · Phase B 集成、验收与发布

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit |
| --- | --- | --- | --- | --- |
| M3-B01 对照与人工标签评测 | B、C / TODO | 固定规则/Pi/影子输出、标签来源 → 指标/冲突/延迟/错误报告 | 分母、模型、场景、版本明确；无专家签核不称独立人工gold；实现B、fixtures/报告脚本C | 人类标签需真实人员签核，不能由Agent代造 |
| M3-B02 AI建议可视化 | A、B / TODO | 真实Advice/Trace → 来源/版本/类别/概率/冲突/原因/耗时 | 明示shadow与未校准，不把动画当执行；web归A、DTO契约Main | 现有面板复用，待M3 |
| M3-B03 关闭/兼容/发布 | Main、B/C / TODO | 完成候选或不合格Laya结果 → 回退验证、v0.9.0 | off核心不变且历史可读；Laya不合格则保持关闭、保留公共/Fixture，明确扩展限制；Main发布 | 未发布；Jev可选，未引入远程商业依赖 |

## M4 · v1.0.0 · Phase A 质量工程

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit |
| --- | --- | --- | --- | --- |
| M4-A01 分层覆盖率 | C / TODO | 全套测试与工具 → 行/函数/分支及分层报告 | 争取核心行/分支80%，不凑数、不相加；工具无分支能力写N/A；tests/scripts归C | 旧Bun LCOV无BRDA，不伪造branch |
| M4-A02 完整E2E与真实模型 | Main、B/C / TODO | 独立TEST全流程 → 文本/PDF/Word、审计/Guard/SSE/复核/整改/治理/存储/降级/决策/刷新/异常证据 | Fake与真实模型分别实测、环境隔离；按所有权 | M1/M2/M3有效证据可复用，注明版本 |
| M4-A03 安全可靠性与性能 | B、C / TODO | 冻结候选+实际负载 → 安全/依赖/性能结果 | 隐私、上传、权限、超时、事务、迁移、并发、决策隔离；带条件和实测值 | 未完成项不得宣称生产就绪 |
| M4-A04 可复制部署运维 | Main、C / TODO | 现有Compose/env/脚本 → 部署/升级/备份恢复/降级验收 | 另一开发者可照文档复现；备份范围明确；Main根配置/文档、脚本C | 数据库备份不冒充对象存储完整DR |

## M4 · v1.0.0 · Phase B 比赛交付与发布

| ID / Task | Owner / Status | 输入 → 交付物 | 验收条件 / 文件所有权 | Evidence / Commit |
| --- | --- | --- | --- | --- |
| M4-B01 5–8分钟演示 | Main、A/C / TODO | 已验收功能/样本 → 标准路径与故障备用 | 真实接口/日志/耗时，离线Fake明确标识；Main文档、A页面、C数据 | 旧演示资产复用 |
| M4-B02 全套技术与用户文档 | Main / TODO | 已验证代码/证据 → 架构/需求/使用/运维/竞品/推广文档 | 竞品有来源，规划与实装分开；docs | 既有竞品纠错已交接，待最终版本 |
| M4-B03 真实软件工程过程证明 | Main / TODO | 2026-09-11起Git/提交/验收 → 生命周期/RTM/ADR/WBS/甘特/风险/变更/发布记录 | 计划时间、提交时间、验收时间分列；不把后补文档伪装历史；docs | 2026-11-10前未来仅计划 |
| M4-B04 最终发布 | Main、A/B/C / TODO | 通过全部闸门的候选 → 六份交付文档、v1.0.0 | verify、E2E、Web/Docker/Compose、数据、安全全跑；无阻塞；Main提交/Tag | 截止2026-11-10；未发布 |

## 继承与执行规则

旧[项目矩阵](../project-management/TASK-MATRIX.md)及[工程甘特](../engineering/gantt.md)保持历史，当前任务状态只更新本板。已有Q/I/A/F/R/SEC/PI-LIVE事项映射到M1稳定性、M2体验、M3决策、M4交付对应行，不另开Phase。每次任务结束同步[HANDOFF](./HANDOFF.md)，实跑结果附日期、候选SHA/工作区、命令、退出码与限制；发布前记录Release Commit和Tag。
