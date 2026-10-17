# 风险与处理约束

基线：`d9a84a4`，2026-10-15。此表区分已观察风险、静态缺口与待验证假设；没有正式风险签核或生产合规认证。S2 五份切片合并至 `a849b29` 后按实际代码与实跑证据更新状态；[BASELINE](./BASELINE.md) 的历史记录保持其当时事实，不随本表回改。

| ID | 优先级 | 已知问题/证据 | 后果 | 处理与Owner | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| RISK-01 | P0 | 三个acceptance清理脚本直接读根.env，忽略PLAYWRIGHT_DATABASE_URL | 清理可能落到错误数据库 | QA统一解析；本轮独立worktree和全新DB | 已修复（`de7ea2d`）：清理helper与webServer同套身份解析，只删本运行创建的案件链并拒绝猜测库；统一回归前不算最终关闭 |
| RISK-02 | P0 | Audit Rerun业务已改为新建case；旧E2E仍调用已复核case的/retry | 验收37/38，旧用例不再证明正确业务不变量 | QA重写为原案保留、新案/新运行、取消不产生副作用的行为验收 | 已修复（`de7ea2d`）：新验收断言原案快照/发现/复核/整改不变、新案新Run同Source Record/Revision；旧"重试"控件不再出现 |
| RISK-03 | P0 | 2026-10-17 起用户指示认证延期：当前无服务端认证、无登录页、无 `/api/session` 路由；X-Operator 仍仅为操作者标记 | 原件、审计、SSE、规则与模型配置对任何能访问该地址的人开放；浏览器隐藏不提供任何保护 | 认证放到最后统一实现（2026-10-17 用户指示）；期间部署必须做网络入口隔离；重新排期时按 `docs/runbook/access-control.md` 的未来最低要求验收；不宣称 SSO/RBAC/多租户 | **已主动延期**：历史实现（`1f33d99` 共享口令/Bearer + HttpOnly 会话、`b2033e1` SSE 吊销、`cc942b2` UI 访问门）已从当前代码移除；历史证据 [`s2-security.json`](./evidence/s2-security.json)（匿名401/授权200/登出204/重放401）与 [`sse-revocation-smoke.json`](./evidence/sse-revocation-smoke.json) 保留为**历史记录**，不代表当前行为；legacy `API_ACCESS_TOKEN` 无效果；仍生效：跨站写入拒绝、`X-Operator` 归属标注、日志脱敏、凭据密封、出网与 locator 边界 |
| RISK-04 | P0 | 原件本地read使用startsWith(root)，S3 read接受locator中的bucket | 路径/桶归属检查需加强 | Infra按真实目录和配置桶限制，行为回归验证 | 已实现（`908cb5a`）：目录/桶归属拒绝+行为测试；[storage-boundary-smoke](./evidence/storage-boundary-smoke.json)实测归档 |
| RISK-05 | P0 | 演示清理必须仅认demoSeed归属；存在审计快照/运行/复核/整改外键链 | 全库或错误对象清理会损害用户数据 | 独立demo/test身份与确认、受管prefix、保留非demo哨兵、两次reset | 已实现（`908cb5a`+`a849b29`）：demo环境登记/库身份/确认值/哨兵/幂等reset；Main正在本地修正qcc核验Source Record重置遗漏，修后回归 |
| RISK-06 | P0 | 原AgentRun无snapshot外键/完成标记；dispatcher完成写入非单一总事务 | 不能将最新snapshot倒配历史运行；影子异常可能污染case状态 | Main锁定准确身份；独立持久化/扫描与失败隔离；不依赖进程内SSE | 已实现（`a6ec041`）：冻结输入身份、激活锁契约（claim/claimCase/createRerunCase共享advisory lock）、影子任务独立持久化；事务边界总体待S3验证 |
| RISK-07 | P0 | Laya strict透传熵集中度；多语权重未拟合温度 | 置信度被误读成正确率，跨provider阈值失效 | AI保存分布、confidenceType/calibrated/版本；未验证不自动路由 | 部分实现（`a6ec041`）：`calibrated=false`+`needsHumanReview`标记入DTO与UI；无自动路由；校准研究延期P2；无真实数据集实测 |
| RISK-08 | P0 | 外部模型可能收到姓名/主体/账号/原文；本轮已取消Jev | 合同数据出域，脱敏不能自动获得外发许可 | 仅接本地Laya，构造最小脱敏输入；Main落实Pi默认出网限制；指定DeepSeek真实验证仅合成合同 | 已实现：出网策略+守卫（`1f33d99`、`b2033e1`）；真实Pi单样本仅合成合同；**字段级出网抓包仍待QA归集** |
| RISK-09 | P1 | 合成中文参考标签尚无人类专家签核 | 不能声称生产准确率或独立人工gold | AI标记标签来源、reviewStatus，分组隔离开发/校准/测试；报告开发集局限 | 未变：60条fixture已带`reviewStatus`并标开发参考标签（`a6ec041`）；外部专家签核前置条件不变 |
| RISK-10 | P1 | Bun原生覆盖率的分支能力待核实 | 不能以line代替branch或相加成总覆盖率 | QA分别报行/函数、集成场景、E2E需求；不可测明确BLOCKED | 已定性（`de7ea2d`）：Bun 1.4.3 LCOV无`BRDA`记录，分支覆盖率不可测量，报告为`null`；行81.1%/函数82.8%单独报，三层不相加 |
| RISK-11 | P1 | 入口JS1599.60kB（gzip502.59kB），Vite发出体积警告 | 冷启动页面资源成本较高 | UX用同一fixture实测加载；按实际需要小步分包 | 未变：视觉重设计后体积将重新实测；尚无用户加载对照 |
| RISK-12 | P1 | 本机Bun1.4.3，CI/Docker固定1.4.0；WSL非Playwright正式支持OS | 环境差异可能导致验收不一致 | 保留版本证据，实际Chromium1243已安装；容器复现验证 | 未变；Makefile/报告已记录Chromium实测探测 |
| RISK-13 | P1 | 默认Compose含开发口令、全网端口与aws-cli:latest；本机另有ignored override | 本机成功不等于第三方可复制或生产安全 | Infra明确版本、localhost、环境配置与不含本机override的复现入口 | 大部分已实现（`908cb5a`）：镜像digest固定、端口默认`127.0.0.1`、profile化`.env.example`；第三方复现记录（K3）待归集 |
| RISK-14 | P1 | dispatcher/session/SSE均进程内；PG claim不等于多副本整体安全 | 多实例取消、重启和事件不同步 | 保持单应用实例部署说明；影子worker自有持久化任务，不扩展为多副本承诺 | 未变：架构限制；影子worker租约/恢复为单实例内实现（`a6ec041`） |
| RISK-15 | P1 | 部分README/架构/启动手册与代码数量、OCR能力不符 | 演示/复制指南误导 | Docs逐项校正，旧历史研究保留其当时语境 | 已校正（`31bb8d1`及本轮）：README/runbook/架构索引按当前实现改口径；历史文档不改写 |
| RISK-16 | P0 | demo核验Source Record未标demo归属，删除非事务；HTTP默认reset无环境/确认门禁 | 重复排练累积孤儿或清理中断，CLI保护可被HTTP绕过 | Infra统一CLI/HTTP授权与事务范围，保留非demo哨兵并检查总行数稳定 | 主体已实现（`908cb5a`+`a849b29`）：登记/确认/哨兵/幂等；Main正在本地修正重置遗漏并加keep-neighbor回归；DB级统一回归前不算关闭 |
| RISK-17 | P1 | 实测375px时finding-nav与inspector均隐藏，复核按钮0；1440px时可见2个 | 窄屏用户无法裁决发现 | UX恢复可达的风险/原文/复核入口，浏览器回归同一条合成合同 | 已修复（`cc942b2`）：`tests/acceptance/ux-workflow.spec.ts`实测375px提交复核并回读、1280/1440/1920三栏同可用；截图归档待S3 |
| RISK-18 | P1 | 全站视觉重设计实施中（用户新增），与既有验收spec/截图共用`styles.css`与组件层 | 过渡期截图/断言可能与视觉基线不一致；重设计可能回退375px面板控制 | VisualRedesign小步交付并保持CSS tokens与Ant主题对齐；四档视口（375/1280/1440/1920）+键盘Playwright验收为门禁；Main统一最终证据 | 实施中（VisualRedesign负责） |

回滚优先关闭新增feature flag并保留兼容数据；迁移只做增量，不运行破坏性down。不使用`docker compose down -v`、全库DROP/TRUNCATE或`git reset --hard`。本轮自建测试数据库不等于获准清空用户原库。
