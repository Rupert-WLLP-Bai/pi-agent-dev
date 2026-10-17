# Contract Audit 开发交接

更新：2026-10-17。**M1/v0.7.0 已发布；M2/v0.8.0 已启动**。唯一任务板：[TASK-BOARD](./TASK-BOARD.md)；[发布记录与回退边界](./RELEASE-v0.7.0.md)；文件 Owner：[FILE-OWNERSHIP](./FILE-OWNERSHIP.md)。

- 当前分支从 `main`（v0.7.0）切出 M2 工作。M1 检查点、Tag 与 CI 证据保留，不重写历史。
- M1-B01/B02/B03、M1-AUTH01 及 CI/GitHub 交付已完成。M2 六项主任务与 [TI 子工作包](./work-packages/execution-inspector.md) 按执行视图推进；代码存在不等于验收通过。
- 切换前 M1 执行视图快照：[recovery/2026-10-17/m1-execution-view-snapshot.md](./recovery/2026-10-17/m1-execution-view-snapshot.md)。
- DEV 配置保护指纹 `53b135dd81bd00d001ce6bab4097efaaf1c0e227dbd9e08d42f9b081174cd15b`。DEV `.env` 未修改；受管 `.demo.env` 0600 且忽略提交。
- SEC3 认证仍延期到最后，不阻塞 M2；其他来源、日志、加密、出网与操作人约束保留。

## 当前执行视图（M2 / v0.8.0）

并行两条线；中间硬依赖见任务板。

| ID | 名称 | 状态 | 说明 |
| --- | --- | --- | --- |
| M2-A01 | 双主题设计系统 | IN_PROGRESS | 默认暗色 + 完整浅色；真实切换与记忆 |
| M2-A02 | 信息架构与路由 | IN_PROGRESS | 现有五组导航、面包屑、旧路由兼容 |
| M2-A03 | 核心工作区 | TODO | 依赖 A01/A02；真实 API，无假统计 |
| M2-B01 | 其余页面一致性 | TODO | 含 Execution Inspector；依赖 A03 与 TI-M1 |
| M2-B02 | 交互、主题与响应式 | TODO | 多视口与减少动效 |
| M2-B03 | 浏览器验收与发布 | TODO | 双主题闸门与 v0.8.0 |
| TI-PREP-02 | 数据审计 | IN_PROGRESS | Run API / Pi / 持久化 / SSE / 指标 |
| TI-PREP-03 | 冻结 TraceEvent | TODO | 依赖 PREP-02；未冻结不改 Trace 产品代码 |
| TI-M1-* | 基础轨迹 | TODO | 依赖 PREP-03 |

下一项：收口 M2-A03/B01–B03 与 TI-M1 阶段验收；M3/M4 待 v0.8.0 闸门后再启动。不启动 M3 功能发布；不做登录认证。

云端分支：`cursor/m2-v080-startup-5ade`（双主题、面包屑、Trace 契约与 TI-M1 初版）。

## 2026-10-17 M1 发布摘要（历史）

完整严格 Gate：单元 835、集成 14、浏览器 48、覆盖层 835，均 0 失败/0 跳过；行 80.48%/函数 80.32%，分支 N/A。归档见[发布证据](./evidence/m1/release-gate-2026-10-17.json)。[CI 39042297765](./evidence/m1/github-ci-2026-10-17.json) 四 job 全过。认证延期证据见 [authentication-deferred](./evidence/m1/authentication-deferred-2026-10-17.json)。

## 历史检查与门禁

2026-10-15 接管、Demo、浏览器与暂停断点记录仍有效作历史；恢复细节见原交接段落备份于 Git 历史 `350c084` 之前的 HANDOFF。当前以本文件顶部与任务板为准。
