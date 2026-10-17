# M1 风险与发布阻塞

M1/v0.7.0已完成本地及GitHub发布验收，2026-10-17。当前状态以[TASK-BOARD](./TASK-BOARD.md)及[发布记录](./RELEASE-v0.7.0.md)为准；历史失败保留，不改写为未发生。

| ID | 级别 | 观察及范围 | 处理/Owner | 当前门禁 |
| --- | --- | --- | --- | --- |
| M1-R01 | P0 | 决策错误体类型、ruleCode与onError状态边界 | 已修正typed status及受限schema | 已关闭：两轮typecheck、835单元、48浏览器及GitHub质量/验收均通过 |
| M1-R02 | P0 | 受管Demo自动读取ignored compose.override.yaml；有效init命令被改成Bun并固定另一个桶，HeadBucket404，而HTTP health200 | Main让全部受管命令复用明确--file compose.yaml；up/verify检查必需组件 | 已关闭：受管up/verify通过；真实上传417字节，originalBackend=s3，locator/大小/SHA256与下载一致 |
| M1-R03 | P1/发布阻塞 | ready在已播种世界检查未创建哨兵；从空环境仅启动infra，未启动API/Web | Main复用既有up，再始终创建可验证且可清理的本轮哨兵，做两次reset | 已关闭：ready实跑30.70秒，两次39案件一致，临时哨兵清理，必需组件与Web就绪 |
| M1-R04 | P0/数据 | 重置需清理fixture核验SourceRecord，同时保留非Demo引用、规则/配置/版本 | Main修正排他归属与剩余引用检查，并修复acceptance清理先删后查的来源遗漏；新增真实PG回归 | 已关闭：受管两次reset孤儿0；独占Source/Revision/Contract全清、共享来源及邻近案件保留；永久回归1pass |
| M1-R05 | P1/发布阻塞 | 单元通过不能替代完整依赖、浏览器与构建Gate；跳过不可当通过 | 严格报告、完整配置/跳过拒绝及逐层日志 | 已关闭：[本地4层全过](./evidence/m1/release-gate-2026-10-17.json)，[GitHub4job全过](./evidence/m1/github-ci-2026-10-17.json)，失败与受控拒绝保留 |
| M1-R06 | P1 | 主机Bun1.4.3与Docker/CI1.4.0差异；本机网络镜像别名不能成为复制依赖 | 固定官方版本并在GitHub直接使用官方镜像验证 | 已验证：两种Bun的typecheck、测试及构建通过；本机镜像获取覆盖仅用于网络绕行 |
| M1-R07 | P1/范围 | 浅色改版已存在，用户新要求默认暗色和完整浅色；M1不得越闸启动M2 | Main保留既有资产，A在M1发布后执行M2 | 默认暗色/主题切换不计M1完成，M2 TODO |
| M3-R01 | 非M1阻塞 | Laya中文参考集60条macroF1=0.4033，非独立人工gold、未校准 | 保持默认off；B/C在M3报告局限，不以概率当正确率；不合格实现不进入自动裁定 | M3既有结果；不阻断既有审计产品 |
| M4-R01 | 非M1阻塞 | Bun LCOV未提供BRDA，不能给出分支覆盖率；没有已证明SSO/RBAC/多副本 | Main/C分项记录N/A与生产边界 | 不伪造指标或生产能力 |
| M1-R08 | 明确延期/非本轮阻塞 | 当前没有登录或服务端身份认证 | 2026-10-17用户要求移除口令、最后再做；SEC3保留延期记录 | 入口需限制访问范围；不得将来源检查或X-Operator归属写成身份认证 |

禁止对未知/生产库使用Demo清理，不删除既有RustFS卷，不移动或覆盖旧Tag。回滚优先关闭新开关，保留增量表和审计历史。DEV `.env`、DEV数据库和原件不属于本轮清理范围。
