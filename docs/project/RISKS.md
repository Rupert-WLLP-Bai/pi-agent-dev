# M1 风险与发布阻塞

当前版本目标v0.7.0，2026-10-15。状态与任务执行以[TASK-BOARD](./TASK-BOARD.md)为准；历史风险证据保留在[旧风险记录](../project-management/RISKS.md)，不把旧失败改写成未发生。

| ID | 级别 | 观察及范围 | 处理/Owner | 当前门禁 |
| --- | --- | --- | --- | --- |
| M1-R01 | P0 | 决策路由普通set.status+联合返回、宽ruleCode及未标状态的onError使错误体进入客户端成功类型 | Main使用真实受限运行时schema及Elysia typed status，A删除fetch/cast适配层 | 修后全仓两轮typecheck已通过；HTTP/路由回归待本轮Gate |
| M1-R02 | P0 | 受管Demo自动读取ignored compose.override.yaml；有效init命令被改成Bun并固定另一个桶，HeadBucket404，而HTTP health200 | Main让全部受管命令复用明确--file compose.yaml；up/verify检查必需组件 | 已关闭：受管up/verify通过；真实上传417字节，originalBackend=s3，locator/大小/SHA256与下载一致 |
| M1-R03 | P1/发布阻塞 | ready在已播种世界检查未创建哨兵；从空环境仅启动infra，未启动API/Web | Main复用既有up，再始终创建可验证且可清理的本轮哨兵，做两次reset | 已关闭：ready实跑30.70秒，两次39案件一致，临时哨兵清理，必需组件与Web就绪 |
| M1-R04 | P0/数据 | 重置需清理fixture核验SourceRecord，同时保留非Demo引用、规则/配置/版本 | Main修正排他归属与剩余引用检查，并修复acceptance清理先删后查的来源遗漏；新增真实PG回归 | 已关闭：受管两次reset孤儿0；独占Source/Revision/Contract全清、共享来源及邻近案件保留；永久回归1pass |
| M1-R05 | P1/发布阻塞 | 单元842通过不等于独立集成/E2E/构建/迁移/Compose已通过；旧报告有不同SHA与跳过项 | C统一报告，Main只发布实际通过候选；test:all沿用既有qa:report | 完整统一Gate待运行 |
| M1-R06 | P1 | 主机Bun1.4.3，Docker/CI1.4.0；本机override不能作为第三方复制前提 | Main以固定官方Compose和Docker构建复验 | frozen安装已通过；镜像/Compose Gate待最终候选 |
| M1-R07 | P1/范围 | 浅色改版已存在，用户新要求默认暗色和完整浅色；M1不得越闸启动M2 | Main保留既有资产，A在M1发布后执行M2 | 默认暗色/主题切换不计M1完成，M2 TODO |
| M3-R01 | 非M1阻塞 | Laya中文参考集60条macroF1=0.4033，非独立人工gold、未校准 | 保持默认off；B/C在M3报告局限，不以概率当正确率；不合格实现不进入自动裁定 | M3既有结果；不阻断既有审计产品 |
| M4-R01 | 非M1阻塞 | Bun LCOV未提供BRDA，不能给出分支覆盖率；没有已证明SSO/RBAC/多副本 | Main/C分项记录N/A与生产边界 | 不伪造指标或生产能力 |

禁止对未知/生产库使用Demo清理，不删除既有RustFS卷，不移动或覆盖旧Tag。回滚优先关闭新开关，保留增量表和审计历史。DEV `.env`、DEV数据库和原件不属于本轮清理范围。
