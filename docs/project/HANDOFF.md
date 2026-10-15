# Contract Audit 开发交接

更新：2026-10-15。当前 **M1 / Phase B**，目标v0.7.0；未发布。唯一任务板：[TASK-BOARD](./TASK-BOARD.md)。文件Owner：[FILE-OWNERSHIP](./FILE-OWNERSHIP.md)。能力与接管基线：[BASELINE](./BASELINE.md)。

- 当前分支`feat/execution-inspector-20261015`，代码保护提交`880ff97`，继承改动检查点`a1e6191`；均不是版本发布，没有创建Tag。原接管分支`release/m1-stabilization-20261015`及本机`.git/m1-takeover-20261015.patch`保留。
- 总体仍为M1/Phase B。TI准备审计曾开始，现已暂停功能开发，先完成任务恢复；29项原状态完整保存于[TI子工作包](./work-packages/execution-inspector.md)。Main拥有恢复文件，两个scout仅核对历史与证据。
- DEV配置保护指纹`53b135dd81bd00d001ce6bab4097efaaf1c0e227dbd9e08d42f9b081174cd15b`。DEV `.env`未修改；受管`.demo.env`0600且忽略提交。

## 实际通过的检查

1. 接管基线：真实迁移TEST库单元842pass/0fail/2736expect，87文件31.68秒；修复typed API后应用/tests两个typecheck通过11.19秒。HTTP决策路由18pass。
2. `bun install --frozen-lockfile`：425 installs/551 packages，无变化。
3. 真实loopback HTTP+PG decision smoke：snapshot/run绑定，反馈幂等，正式case/snapshot/findings/runs哈希不变，off后历史可读。本机`/tmp/contract-audit-decision-sql-evidence.json`。
4. 受管Demo：明确`--file compose.yaml`修复ignored override污染；`up`35.19秒通过，`ready`30.70秒通过，两次reset各39案件、非Demo哨兵保留并清理、孤儿0、必需组件/Web就绪。`verify`另行通过。
5. 严格S3 smoke：61字节真实往返、篡改/异桶/缺失拒绝、历史本地原件可读；本机`/tmp/contract-audit-s3-owned-evidence.json`。
6. 浏览器真实上传案件`790e61fe-6b0b-4d71-9055-4ca763a062ec`：原件417字节，SHA256=`9016b9e4b45a554f08cf510ba21c71b1728e8e072ef6f9ac69a25a37ad31473d`；DB originalBackend=s3，locator=`s3://contract-audit-demo-originals/243ea5a3-0aaf-45a1-96e1-e069df00ab6e.txt`，下载一致。70%对30%原文/制度证据定位，5项人工确认后案件COMPLETED，5项整改生成，其中预付款整改已推进并关闭，刷新后仍在已关闭列。Trace明确`Fake 0 · fake-agent`，46步/263ms，含真实结构化工具入参/证据/Guard accepted结果；不是实时模型结果。
7. Web生产构建15.48秒通过，有单块1618kB警告；独立E2E数据库迁移通过。
8. acceptance清理助手先删案件后查询来源的缺陷已修：先捕获归属，仅清除已无案件引用的SourceRecord；独占Source/Revision/Contract全清，共享来源/版本/合同及邻近案件保留。throwaway先失败后通过；永久`tests/integration/acceptance-cleanup.test.ts`1pass/0fail。
9. Laya离线CPU60条：60/60回答，macroF1=0.4033/P95=495ms，仅开发参考标签、未校准，不算M3发布。

## 当前运行与隔离

- DEV：API3000（contract-audit-package-watch）、Web5173（contract-audit-live-web），保留用户路径。
- DEMO：Compose contract-audit-demo，API13002/Web18080，PG15434/Redis16380/RustFS19002/19003，库contract_audit_demo；已健康。浏览器新增的合成案件不属于seed管理的39个案件，reset应保留。
- TEST：库contract_audit_test_s3_1792046701254；独立E2E库contract_audit_test_e2e_1792047240007；已迁移。独立桶contract-audit-test-m1-1792052237569，Redis逻辑库14，E2E端口14002/15002，Fake、decision off。完整私密配置`/tmp/contract-audit-m1-gate.env`0600；禁止打印其内容或提交。
- 本地Laya3847，固定revision、离线CPU4线程；正式决策默认off。
- 原浏览器tab名`m1-release-demo`及JS变量仅作当时运行记录，本次交接不保证仍存活。工具label/日期填入问题已用role与native事件解决，业务证据已归档[浏览器记录](./evidence/m1/browser.json)。

## 当前门禁与下一步

1. 第一轮verify在lint停下（9项）；Main已对实际改动文件格式化，并接入faults sanitizer，修正S3集成静态skip/5xx处理和finally清理。
2. 第二轮verify曾840pass/2fail；后续修正的完整verify已通过：841pass/0fail/2729expect，87文件31.76秒，整体44.56秒。原命令`bun --env-file=/tmp/contract-audit-m1-gate.env run verify`，2026-10-15T08:28:37Z后台结果bg_30，`artifact://1698`。历史失败保留，不能当作当前仍失败。
3. Docker API/Web固定Bun1.4.0构建已通过：`docker compose --file compose.yaml --env-file .demo.env --project-name contract-audit-demo build api web`，bg_28于08:24:15Z交回，79.91秒，`artifact://1695`；Web单块1618kB警告仍在。完整来源见[验证记录](./recovery/2026-10-15/verification-provenance.json)，不在恢复任务中重跑产品检查。
4. 下一项全局工作仍为M1-B02：`bun --env-file=/tmp/contract-audit-m1-gate.env run test:all`完整四层统一报告尚无已执行通过记录。test:all复用QA_REQUIRE_ALL=1 qa:report，unit/integration/e2e/coverage缺层必须失败；保持独立TEST目标，不读DEV配置清理数据。
5. 已归档RustFS重启后原件读取、同源重新审计及原案正式数据不变（浏览器记录第27、52–60行）。其余迁移一致性、故障/安全及最终发布记录须在完整Gate归集；通过前不创建v0.7.0，不进入正式M2。
6. 当前截图本机：dashboard `/tmp/omp-sshots-15a6f353901e5463.webp`，evidence `/tmp/omp-sshots-15a6f431fe5e5464.webp`，remediation `/tmp/omp-sshots-15a6f71dad5e5465.webp`；后续汇总到发布证据。

## 任务恢复与执行视图

全局工作保存在[TASK-BOARD](./TASK-BOARD.md)：四个总体Milestone、原S/Q/I/A/F/R任务、后续V1/SEC/PI-LIVE及TI子工作包。OMP只显示当前Milestone的关键任务；切换前先持久化旧视图，规则见[task-management](./task-management.md)。恢复原因、候选与校验见[恢复记录](./recovery/2026-10-15/README.md)。开发周期2026-09-11至2026-11-10、V1截止2026-11-10；TI不另立总体Milestone。恢复后从M1-B02继续项目验收，TI准备审计状态保留为IN_PROGRESS，不能误记完成。
