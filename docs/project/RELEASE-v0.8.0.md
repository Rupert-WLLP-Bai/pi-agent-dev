# Release v0.8.0 · M2 前端体验与 Execution Inspector

状态：候选（候选分支 `cursor/m2-v080-startup-5ade`）。Tag 在统一闸门通过后由 Main 创建。

## 范围

- 双主题设计系统：默认暗色、完整浅色、顶栏切换与 localStorage 记忆
- 信息架构：现有五组业务导航、面包屑、旧路由兼容
- Agent Execution Inspector（TI-M1 初版）：运行概况、「未提供」指标、对话/轨迹/泳道
- TraceEvent 契约冻结：`docs/architecture/TRACE-EVENT-CONTRACT.md`
- 页面状态一致性：共享 `PageLoading` / `PageError` / `PageEmpty`

## 明确不在本版

- SEC3 登录认证（用户要求留到最后）
- M3 影子决策发布验收（默认仍 `DECISION_MODE=off`）
- TI-M2 可调宽 Inspector / 搜索筛选完整交互（后续）

## 验收证据

| 检查 | 结果 |
| --- | --- |
| typecheck | 分支内通过 |
| web 单测 | `bun --env-file=.env test apps/web/src` |
| TI-PREP 审计 | [evidence/m2/ti-prep-02-audit.md](./evidence/m2/ti-prep-02-audit.md) |
| 主题/面包屑 | theme-mode + breadcrumbs 单测 |

浏览器多视口（1920/1440/1024/768/375）与双主题截图：见 [evidence/m2/viewport-checklist.md](./evidence/m2/viewport-checklist.md)；完整 Playwright 闸门在可用 TEST 库上执行后归档。

## 回退

回退到 `v0.7.0` Tag；主题与 Trace UI 为前端变更，无强制迁移。
