# Contract Audit 开发交接

更新：2026-10-17。**M1/v0.7.0发布交付完成，后续M2待启动**。唯一任务板：[TASK-BOARD](./TASK-BOARD.md)；[发布记录与回退边界](./RELEASE-v0.7.0.md)；文件Owner：[FILE-OWNERSHIP](./FILE-OWNERSHIP.md)。

- 当前分支`main`。`11bdc68`为修复/认证延期，`1ed3f90`为CI，`d82b66c`为证据格式修正；已fast-forward合入并推送，v0.7.0使用独立Tag，未重写历史。保护检查点、接管分支与本机补丁保留。
- M1-B01/B02/B03、M1-AUTH01及CI/GitHub交付已完成。后续M2与TI功能开发未计作完成；[TI子工作包](./work-packages/execution-inspector.md)的29项原状态保留。
- DEV配置保护指纹`53b135dd81bd00d001ce6bab4097efaaf1c0e227dbd9e08d42f9b081174cd15b`。DEV `.env`未修改；受管`.demo.env`0600且忽略提交。
- M1-AUTH01已完成：2026-10-17按用户要求移除登录口令与会话API，认证延期到最后；[直达业务及容器实测](./evidence/m1/authentication-deferred-2026-10-17.json)记录200/404/来源403、2项复核与整改。SEC3仍延期、不阻塞M1；其他来源、日志、加密、出网与操作人约束保留。

## 2026-10-17续作

已修复分层HTML报告、Playwright收集与来源配置、真实HTTP上传限额、未知路由错误分类、备份恢复目标和SIGTERM/SIGINT退出。数据库维护锁定时先停HTTP，5秒截止后明确超时退出；严格测试入口拒绝缺少Redis/S3配置与测试跳过。两项最终审查发现均已修复并实际验证。

最新`verify`通过：835pass/0fail/2704expect，87文件；lint与两轮TypeScript通过。完整严格Gate为4层全通过：单元835、集成14、浏览器48、覆盖层835，均0失败/0跳过；行80.48%/函数80.32%，分支N/A。归档见[发布证据](./evidence/m1/release-gate-2026-10-17.json)。固定Bun1.4.0的API/Web镜像已构建并部署；Web单块1614.71kB警告保留。

独立容器项目`contract-audit-demo-release-1792243640303`：Web28080/API23002，PG25434/Redis26380/RustFS29002与29003。私密环境文件`/tmp/contract-audit-container-1792243640303.env`及额外镜像覆盖文件同前缀`.yaml`，不提交凭据。`DEMO_ENV_FILE`指定该文件的reset/seed/verify已通过：两次各39案件、孤儿0、人工复核的非Demo案件仍COMPLETED。开发者`.env`未改。

本机3个已安装SDK声明损坏，经同锁文件干净容器发行包比较并逐字恢复后，主机与容器typecheck通过，未修改依赖版本或提交node_modules。首轮CI 39042065137在新增证据JSON格式检查失败；修正后的[CI 39042297765](./evidence/m1/github-ci-2026-10-17.json)已完成质量、真实集成/故障、浏览器和构建四job且全部成功。较早失败及暂停记录保留在下方，不能作为当前阻塞。


## 历史检查（2026-10-15）

1. 接管基线：真实迁移TEST库单元842pass/0fail/2736expect，87文件31.68秒；修复typed API后应用/tests两个typecheck通过11.19秒。HTTP决策路由18pass。
2. `bun install --frozen-lockfile`：425 installs/551 packages，无变化。
3. 真实loopback HTTP+PG decision smoke：snapshot/run绑定，反馈幂等，正式case/snapshot/findings/runs哈希不变，off后历史可读。本机`/tmp/contract-audit-decision-sql-evidence.json`。
4. 受管Demo：明确`--file compose.yaml`修复ignored override污染；`up`35.19秒通过，`ready`30.70秒通过，两次reset各39案件、非Demo哨兵保留并清理、孤儿0、必需组件/Web就绪。`verify`另行通过。
5. 严格S3 smoke：61字节真实往返、篡改/异桶/缺失拒绝、历史本地原件可读；本机`/tmp/contract-audit-s3-owned-evidence.json`。
6. 浏览器真实上传案件`790e61fe-6b0b-4d71-9055-4ca763a062ec`：原件417字节，SHA256=`9016b9e4b45a554f08cf510ba21c71b1728e8e072ef6f9ac69a25a37ad31473d`；DB originalBackend=s3，locator=`s3://contract-audit-demo-originals/243ea5a3-0aaf-45a1-96e1-e069df00ab6e.txt`，下载一致。70%对30%原文/制度证据定位，5项人工确认后案件COMPLETED，5项整改生成，其中预付款整改已推进并关闭，刷新后仍在已关闭列。Trace明确`Fake 0 · fake-agent`，46步/263ms，含真实结构化工具入参/证据/Guard accepted结果；不是实时模型结果。
7. Web生产构建15.48秒通过，有单块1618kB警告；独立E2E数据库迁移通过。
8. acceptance清理助手先删案件后查询来源的缺陷已修：先捕获归属，仅清除已无案件引用的SourceRecord；独占Source/Revision/Contract全清，共享来源/版本/合同及邻近案件保留。throwaway先失败后通过；永久`tests/integration/acceptance-cleanup.test.ts`1pass/0fail。
9. Laya离线CPU60条：60/60回答，macroF1=0.4033/P95=495ms，仅开发参考标签、未校准，不算M3发布。

## 历史运行与隔离（2026-10-15）

- DEV：API3000（contract-audit-package-watch）、Web5173（contract-audit-live-web），保留用户路径。
- DEMO：Compose contract-audit-demo，API13002/Web18080，PG15434/Redis16380/RustFS19002/19003，库contract_audit_demo；已健康。浏览器新增的合成案件不属于seed管理的39个案件，reset应保留。
- TEST：库contract_audit_test_s3_1792046701254；独立E2E库contract_audit_test_e2e_1792047240007；已迁移。独立桶contract-audit-test-m1-1792052237569，Redis逻辑库14，E2E端口14002/15002，Fake、decision off。完整私密配置`/tmp/contract-audit-m1-gate.env`0600；禁止打印其内容或提交。
- 本地Laya3847，固定revision、离线CPU4线程；正式决策默认off。
- 原浏览器tab名`m1-release-demo`及JS变量仅作当时运行记录，本次交接不保证仍存活。工具label/日期填入问题已用role与native事件解决，业务证据已归档[浏览器记录](./evidence/m1/browser.json)。

## 历史门禁记录（2026-10-15）

1. 第一轮verify在lint停下（9项）；Main已对实际改动文件格式化，并接入faults sanitizer，修正S3集成静态skip/5xx处理和finally清理。
2. 第二轮verify曾840pass/2fail；后续修正的完整verify已通过：841pass/0fail/2729expect，87文件31.76秒，整体44.56秒。原命令`bun --env-file=/tmp/contract-audit-m1-gate.env run verify`，2026-10-15T08:28:37Z后台结果bg_30，`artifact://1698`。历史失败保留，不能当作当前仍失败。
3. Docker API/Web固定Bun1.4.0构建已通过：`docker compose --file compose.yaml --env-file .demo.env --project-name contract-audit-demo build api web`，bg_28于08:24:15Z交回，79.91秒，`artifact://1695`；Web单块1618kB警告仍在。完整来源见[验证记录](./recovery/2026-10-15/verification-provenance.json)，不在恢复任务中重跑产品检查。
4. M1-B02已于本次续作执行完整四层入口，失败结果和下一步见下方“暂停断点”；不能继续引用“尚未运行”。test:all复用QA_REQUIRE_ALL=1 qa:report，保持独立TEST目标，不读DEV配置清理数据。
5. 已归档RustFS重启后原件读取、同源重新审计及原案正式数据不变（浏览器记录第27、52–60行）。其余迁移一致性、故障/安全及最终发布记录须在完整Gate归集；通过前不创建v0.7.0，不进入正式M2。
6. 当前截图本机：dashboard `/tmp/omp-sshots-15a6f353901e5463.webp`，evidence `/tmp/omp-sshots-15a6f431fe5e5464.webp`，remediation `/tmp/omp-sshots-15a6f71dad5e5465.webp`；后续汇总到发布证据。

## 历史任务恢复与执行视图

全局工作保存在[TASK-BOARD](./TASK-BOARD.md)：四个总体Milestone、原S/Q/I/A/F/R任务、后续V1/SEC/PI-LIVE及TI子工作包。OMP只显示当前Milestone的关键任务；切换前先持久化旧视图，规则见[task-management](./task-management.md)。恢复原因、候选与校验见[恢复记录](./recovery/2026-10-15/README.md)。开发周期2026-09-11至2026-11-10、V1截止2026-11-10；TI不另立总体Milestone。恢复后从M1-B02继续项目验收，TI准备审计状态保留为IN_PROGRESS，不能误记完成。

## 暂停断点 · 2026-10-15

用户明确要求“暂停当前工作，明天继续从这里开始”。停止实施和验证；M1-B02、M1-B03在执行视图中标记BLOCKED，解除条件为用户要求继续。TI仍暂停。最后完整代码/任务恢复检查点为f245e96；本次续作没有修改应用、配置或测试源码，也未创建v0.7.0 Tag。

- 已新建并迁移两个独立TEST库：`contract_audit_test_m1_final_1792056038383`、`contract_audit_test_m1_e2e_1792056038383`；两次迁移退出0。`bun run check:migrations`通过。未改开发者.env或清理DEV/DEMO数据。
- 本轮私密配置`/tmp/contract-audit-m1-final-1792056038383.env`为0600；旧配置`/tmp/contract-audit-m1-gate.env`仍在。仅用于加载，不打印内容。测试端口14002/15002；Docker依赖检查均健康。
- 已运行`bun --env-file=/tmp/contract-audit-m1-final-1792056038383.env run test:all`，bg_34于77.44秒后退出1。JSON报告已生成：[本轮结果](../../artifacts/qa/m1-final-1792056038383/f245e96dbbfe33467607c6cf3ab147087f15bd66/summary.json)。单元837通过/4失败；集成17通过/3失败/2跳过；E2E未执行用例；覆盖率层837通过/4失败。这些是本轮失败证据，不能沿用旧verify通过替代。
- 确定缺陷1：`scripts/qa/report.ts:397`调用renderHtml时，432行的const escapeHtml尚未初始化，触发ReferenceError。JSON已写出、HTML未完成。LSP在432行没有可用code action；尚未编辑。
- 确定缺陷2：Playwright当前testDir为整个tests，收集了fixtures/integration下的Bun测试，Node无法加载bun:test。原始错误在`artifacts/qa/e2e/results.json`；需要让Playwright只收集浏览器验收目录，不能跳过既有浏览器用例。尚未编辑。
- 配置诊断未收口：本轮JSON明确记录Redis/S3 configured=false；需检查环境加载时继承空变量覆盖私密配置的路径。实际依赖健康不代表测试进程收到配置。当前报告没有保存每层完整失败日志，后续修复需保留脱敏输出以定位实际用例失败。
- M1StandardsReview与M1SpecReview已按暂停要求结束。两者均静态确认`backup-restore.ts:216–219`的pg_restore缺少`--dbname`，可能仅输出并丢弃SQL、误报恢复成功；规范审查另确认`app.ts:348–349`的SIGTERM/SIGINT处理只停止decision而未结束HTTP/DB，可能使faults等待proc.exited不退出。这两项尚未由Main实际运行验证或修复，恢复后优先处理。审查其余范围未完成，不宣称全面通过。固定审查范围a849b29...f245e96，共享说明`local://m1-release-review-context.md`。

恢复后从上述已观察失败处修复，不重复确认旧错误；然后使用隔离环境完成四层、故障/安全和最新容器实际表面验收，归集证据后才推进M1-B03发布。
