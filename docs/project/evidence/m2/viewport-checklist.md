# M2-B02 视口与主题验收清单

| 视口 | 侧栏 | 面包屑 | 主题切换 | 轨迹三视图 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 1920×1080 | 展开可收 | 可见 | 暗/浅 | 对话/轨迹/泳道 | 待浏览器实操归档 |
| 1440×900 | 展开可收 | 可见 | 暗/浅 | 同上 | 待归档 |
| 1024×768 | 图标栏 | 可见 | 暗/浅 | 同上 | 待归档 |
| 768 | 图标栏 | 压缩 | 暗/浅 | 可滚动 | 待归档 |
| 375 | Drawer 菜单 | 压缩 | 暗/浅 | Tabs/滚动 | 待归档 |

`prefers-reduced-motion: reduce`：KPI/token 过渡已禁用。主题记忆键：`contract-audit:theme-mode`（默认 dark）。

命令（验收时）：

```bash
bun --filter @contract-audit/web build
CI=true bunx playwright test tests/acceptance --project=chromium
```
