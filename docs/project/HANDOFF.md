# Contract Audit 开发交接

更新：2026-10-15。当前 **M1 / Phase B**，目标v0.7.0；未发布。唯一任务板：[TASK-BOARD](./TASK-BOARD.md)。文件Owner：[FILE-OWNERSHIP](./FILE-OWNERSHIP.md)。能力与接管基线：[BASELINE](./BASELINE.md)。

- 分支`release/m1-stabilization-20261015`，已提交HEAD仍为`a849b29`；没有创建Tag。继承WIP已保存到本机`.git/m1-takeover-20261015.patch`，不得reset/clean。
- A/B/C当前切片均已冻结交接；Main接管集成，未启动M2。
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
- 浏览器tab m1-release-demo，JS kernel仍保留m1Managed/m1QaEnv/m1CaseId等变量。工具label/复核人对无id输入未填入、native date fill格式错误及scoped observe空结果已报工具问题；改用role定位与native date事件后业务闭环通过，不是产品失败。

## 当前门禁与下一步

1. 第一轮verify在lint停下（9项）；Main已对实际改动文件格式化，并接入faults sanitizer，修正S3集成静态skip/5xx处理和finally清理。
2. 第二轮verify：lint及typecheck通过，单元840pass/2fail（842总计），31.88秒；失败原始日志`artifact://1692`，正定位失败项，不能宣称通过。
3. Docker API/Web固定Bun1.4.0镜像构建正在后台bg_28，不轮询；结果自动交回。
4. 修复上述真实失败后完成verify与`bun --env-file=/tmp/contract-audit-m1-gate.env run test:all`。test:all已复用QA_REQUIRE_ALL=1 qa:report，四层unit/integration/e2e/coverage，缺层必须失败。报告Bun计数已支持前导空白，E2E需显式PLAYWRIGHT_DATABASE_URL；cleanup也只使用该目标，不读DEV `.env`。
5. 还需RustFS重启后原件/重新审计、迁移一致性、故障/安全和最终发布记录；通过前不创建v0.7.0，不进入M2。保存源代码检查点，再让统一报告记录候选SHA。
6. 当前截图本机：dashboard `/tmp/omp-sshots-15a6f353901e5463.webp`，evidence `/tmp/omp-sshots-15a6f431fe5e5464.webp`，remediation `/tmp/omp-sshots-15a6f71dad5e5465.webp`；后续汇总到发布证据。
