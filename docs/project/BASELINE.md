# Contract Audit M1 接管基线

记录：2026-10-15。当前工作分支 `release/m1-stabilization-20261015`，接管 HEAD `a849b29`。历史 S0 基线 `d9a84a4055b629d9b1af12e545dbcd574fcf416b` 及其验收记录保持原样；[S0](../project-management/BASELINE.md)、[S1 实跑](../project-management/evidence/s1-verification.json)、[公共契约](../architecture/INTEGRATION-CONTRACT.md)为输入。

## 保护与环境

- 接管时 main 比 origin/main 领先22个提交；暂存0、修改43、未跟踪2；没有已有版本Tag。未重置、清理、强推、改写Tag或删除数据卷。
- 已建立独立发布分支；原始跟踪改动保存为本机 `.git/m1-takeover-20261015.patch`，新增PG smoke另存 `.git/m1-new-pg-smoke-20261015.patch`。这是未发布工作快照，不是验收通过声明。
- 两个未跟踪文件：`scripts/decision/pg-smoke.ts`为实际PG行为验证；`apps/web/src/__probe.ts`是前端作者的临时类型探针，作者已交接删除。
- 开发者 `.env` 指纹：`53b135dd81bd00d001ce6bab4097efaaf1c0e227dbd9e08d42f9b081174cd15b`；内容不归档、不打印、不改写。受管Demo使用独立0600的`.demo.env`。
- 实测 Bun1.4.3、Node24.19.0、Docker29.8.2、Compose5.5.1。API/Web Dockerfile固定Bun1.4.0；版本差异保留为复现条件。
- DEV：API3000/Web5173，开发库`contract_audit`；DEMO：API13002/Web18080、PG15434、Redis16380、RustFS19002/19003、库`contract_audit_demo`；TEST：本轮新建`contract_audit_test_s3_1792046701254`和`contract_audit_test_e2e_1792047240007`，凭据仅在本机0600文件。

## 当前能力分类

IMPLEMENTED表示有实际实现及下列证据，不表示整个M1已发布。PARTIAL/BROKEN需通过任务板闸门后才能关闭。

| 能力 | 状态 | 实现与证据 | M1剩余验收 |
| --- | --- | --- | --- |
| 19条规则 | IMPLEMENTED | `packages/audit/src/rule-catalog.ts`、`golden-set.test.ts`；本轮842用例中包含规则回归 | 完整发布闸门 |
| Contract Stance | IMPLEMENTED | `packages/audit/src/contract-stance.ts`及单测 | 保持NOT_APPLICABLE语义 |
| Pi与受控工具 | IMPLEMENTED | `packages/pi-agent/src/runtime.ts`、`tools.ts`；[既有真实合成样本记录](../project-management/evidence/real-pi-smoke.json) | 本轮Fake闭环；真实模型证据分报 |
| Proposal Guard | IMPLEMENTED | `proposal-guard.ts`及行为回归 | 不放宽裁定权 |
| 队列/SSE | IMPLEMENTED | `apps/api/src/dispatcher.ts`、`sse.ts`、PG队列仓库 | 独立TEST集成与浏览器阶段一致性 |
| PostgreSQL留痕 | IMPLEMENTED | 不可变快照、追加Finding、复核/整改仓库；真实PG HTTP已运行 | 新库迁移及持久化闭环 |
| S3兼容/RustFS | BROKEN | 适配器已有；受管Demo实测HeadBucket404；本机override覆盖了初始化命令 | 固定Compose输入、真实上传下载/hash/引用 |
| Redis核验缓存 | IMPLEMENTED | `apps/api/src/qcc/cache.ts`；受管DemoRedis健康 | 真实命中及不可达降级 |
| 规则治理/版本 | IMPLEMENTED | rules/validation路由、rule-repository与规则参数快照 | 关键E2E |
| 人工复核/整改 | IMPLEMENTED | reviews/remediations路由及842用例中行为测试 | 浏览器接受/驳回与持久化 |
| 模型服务管理 | IMPLEMENTED | llm仓库、密钥密封/轮换、provider设置 | 配置与凭据不泄漏 |
| OCR/VLM | PARTIAL | 现有可替换OCR、PDF/Word解析和配置页；Demo不应继承DEV识别服务 | 文本/Word/PDF回归；OCR按显式配置可选 |
| Demo数据 | PARTIAL | 原子受保护reset及固定样本已实现；fixture核验源清理回归已通过 | 两次reset、非Demo哨兵、ready缺陷修复 |
| Laya/Jev决策 | PARTIAL | 默认off；真实PG/HTTP已证明快照/运行绑定、反馈幂等且正式行不变；Laya60/60回答，macroF1=0.4033、P95=495ms | M1只保留关闭状态兼容；独立评测/人工标签属M3；Jev未接入 |
| 前端及关键验收 | PARTIAL | 现有全部路由、三栏/375px面板、浅色新版；实际1440px截图已观察 | typed API修正后完整E2E；暗色/主题切换属M2 |
| 默认暗色/完整主题切换 | DEFERRED | 当前只完成浅色与深色侧栏 | M1发布后进入M2 |

Laya结果来自开发者参考标签，不是独立专家gold或生产准确率；不作为正式规则裁定依据。

## 本轮已经执行

| 命令/场景 | 实测结果 | 限制 |
| --- | --- | --- |
| `bun --env-file=/tmp/contract-audit-s3-runtime.env run test` | 842 pass /0 fail，2736 expect，87文件，31.68秒 | 使用新建迁移TEST库；工作区状态，非发布SHA |
| 决策真实loopback HTTP+PG smoke | 成功；正式案件AWAITING_REVIEW、建议SUCCEEDED；反馈重试同事件；正式case/snapshot/finding/run哈希不变；关闭后历史可读 | Fake Provider，不证明真实LLM效果 |
| 固定revision Laya CPU评测 | 60/60回答、0失败；macroF1=0.4033；P95=495ms | 参考标签，未校准；默认关闭 |
| DEV `/api/health` | 200，DB/dispatcher正常、pi配置存在 | 配置健康不等于本轮真实模型运行 |
| DEMO `/api/health` | 200，DB/Redis/dispatcher正常，objectStore=false | 不能认定完整环境就绪；HeadBucket经固定AWS客户端实测404 |
| 本轮首次`bun run typecheck` | 失败，跨包DTO/HTTP状态推导缺陷 | Main正在修复，不能当成通过 |

统一发布测试、Web/Docker构建、Compose真实上传与完整浏览器闭环尚未全部执行。当前版本没有发布，v0.7.0尚未创建。

当前任务唯一来源：[TASK-BOARD](./TASK-BOARD.md)。会话继续入口：[HANDOFF](./HANDOFF.md)。
