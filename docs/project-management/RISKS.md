# 风险与处理约束

基线：`d9a84a4`，2026-10-15。此表区分已观察风险、静态缺口与待验证假设；没有正式风险签核或生产合规认证。

| ID | 优先级 | 已知问题/证据 | 后果 | 处理与Owner | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| RISK-01 | P0 | 三个acceptance清理脚本直接读根.env，忽略PLAYWRIGHT_DATABASE_URL | 清理可能落到错误数据库 | QA统一解析；本轮独立worktree和全新DB | 复现隔离已落实，产品测试配置待修 |
| RISK-02 | P0 | Audit Rerun业务已改为新建case；旧E2E仍调用已复核case的/retry | 验收37/38，旧用例不再证明正确业务不变量 | QA重写为原案保留、新案/新运行、取消不产生副作用的行为验收 | 已有实际失败证据 |
| RISK-03 | P0 | 当前无服务端认证；X-Operator仅操作者标记 | 原件、审计、SSE及配置不能依赖浏览器隐藏保护 | Main实现共享口令/Bearer与HttpOnly会话，UX接登录，QA验证拒绝/授权；不宣称SSO/RBAC | S1已定契约，S2待实施 |
| RISK-04 | P0 | 原件本地read使用startsWith(root)，S3 read接受locator中的bucket | 路径/桶归属检查需加强 | Infra按真实目录和配置桶限制，行为回归验证 | 静态缺口，待修 |
| RISK-05 | P0 | 演示清理必须仅认demoSeed归属；存在审计快照/运行/复核/整改外键链 | 全库或错误对象清理会损害用户数据 | 独立demo/test身份与确认、受管prefix、保留非demo哨兵、两次reset | 现有seed可复用，保护需强化 |
| RISK-06 | P0 | 原AgentRun无snapshot外键/完成标记；dispatcher完成写入非单一总事务 | 不能将最新snapshot倒配历史运行；影子异常可能污染case状态 | Main锁定准确身份；独立持久化/扫描与失败隔离；不依赖进程内SSE | S1设计门禁 |
| RISK-07 | P0 | Laya strict透传熵集中度；多语权重未拟合温度 | 置信度被误读成正确率，跨provider阈值失效 | AI保存分布、confidenceType/calibrated/版本；未验证不自动路由 | 研究已核实，尚无模型实测 |
| RISK-08 | P0 | 外部模型可能收到姓名/主体/账号/原文；本轮已取消Jev | 合同数据出域，脱敏不能自动获得外发许可 | 仅接本地Laya，构造最小脱敏输入；Main落实Pi默认出网限制；指定DeepSeek真实验证仅合成合同 | S1已定边界，需抓取真实发送字段验证 |
| RISK-09 | P1 | 合成中文参考标签尚无人类专家签核 | 不能声称生产准确率或独立人工gold | AI标记标签来源、reviewStatus，分组隔离开发/校准/测试；报告开发集局限 | 外部专家签核前置条件 |
| RISK-10 | P1 | Bun原生覆盖率的分支能力待核实 | 不能以line代替branch或相加成总覆盖率 | QA分别报行/函数、集成场景、E2E需求；不可测明确BLOCKED | 未配置覆盖率工件 |
| RISK-11 | P1 | 入口JS1599.60kB（gzip502.59kB），Vite发出体积警告 | 冷启动页面资源成本较高 | UX用同一fixture实测加载；按实际需要小步分包 | 构建通过，尚无用户加载对照 |
| RISK-12 | P1 | 本机Bun1.4.3，CI/Docker固定1.4.0；WSL非Playwright正式支持OS | 环境差异可能导致验收不一致 | 保留版本证据，实际Chromium1243已安装；容器复现验证 | 已记录 |
| RISK-13 | P1 | 默认Compose含开发口令、全网端口与aws-cli:latest；本机另有ignored override | 本机成功不等于第三方可复制或生产安全 | Infra明确版本、localhost、环境配置与不含本机override的复现入口 | 需改进 |
| RISK-14 | P1 | dispatcher/session/SSE均进程内；PG claim不等于多副本整体安全 | 多实例取消、重启和事件不同步 | 保持单应用实例部署说明；影子worker自有持久化任务，不扩展为多副本承诺 | 架构限制 |
| RISK-15 | P1 | 部分README/架构/启动手册与代码数量、OCR能力不符 | 演示/复制指南误导 | Docs逐项校正，旧历史研究保留其当时语境 | 已定位 |
| RISK-16 | P0 | demo核验Source Record未标demo归属，删除非事务；HTTP默认reset无环境/确认门禁 | 重复排练累积孤儿或清理中断，CLI保护可被HTTP绕过 | Infra统一CLI/HTTP授权与事务范围，保留非demo哨兵并检查总行数稳定 | 静态确认，待DB级回归 |
| RISK-17 | P1 | 实测375px时finding-nav与inspector均隐藏，复核按钮0；1440px时可见2个 | 窄屏用户无法裁决发现 | UX恢复可达的风险/原文/复核入口，浏览器回归同一条合成合同 | 已复现并保存截图 |

回滚优先关闭新增feature flag并保留兼容数据；迁移只做增量，不运行破坏性down。不使用`docker compose down -v`、全库DROP/TRUNCATE或`git reset --hard`。本轮自建测试数据库不等于获准清空用户原库。
