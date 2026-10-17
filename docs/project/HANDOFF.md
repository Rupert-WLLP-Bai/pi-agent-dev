# Contract Audit 开发交接

更新：2026-10-17。**M2→M4 候选已在分支落地**；统一 Tag 与专家 gold / SEC3 仍诚实未关。唯一任务板：[TASK-BOARD](./TASK-BOARD.md)。

## 云端分支（请本地拉取）

```bash
git fetch origin
git checkout cursor/m2-v080-startup-5ade
# 最新含 verify 824 pass / 27 skip / 0 fail
```

仓库：https://github.com/Rupert-WLLP-Bai/pi-agent-dev/tree/cursor/m2-v080-startup-5ade

## 里程碑

| Milestone | 记录 | 状态 |
| --- | --- | --- |
| M1 / v0.7.0 | [RELEASE-v0.7.0](./RELEASE-v0.7.0.md) | 已发布（main Tag） |
| M2 / v0.8.0 | [RELEASE-v0.8.0](./RELEASE-v0.8.0.md) | 候选；A01/A02 DONE；A03/B* IN_PROGRESS |
| M3 / v0.9.0 | [RELEASE-v0.9.0](./RELEASE-v0.9.0.md) | 候选；默认 off；B01 专家 gold **BLOCKED** |
| M4 / v1.0.0 | [RELEASE-v1.0.0](./RELEASE-v1.0.0.md) | 候选清单 + verify-summary |

## 本分支已交付

- 双主题（默认暗色）+ Alt+Shift+L；面包屑；PageStatus
- TI-PREP 审计 + TraceEvent 契约；TI-M1 概况/对话/轨迹/泳道 +「未提供」
- M3 inventory / acceptance / Fake eval JSON
- M4 demo-script、rtm-index、verify-summary（**824 pass / 27 skip / 0 fail**）

## 诚实未关闭（无法由 Agent 单独关闭）

1. **M3-B01** 专家人工 gold 签核  
2. **多视口双主题 Playwright 截图实操归档**（清单已写）  
3. **Git Tag** `v0.8.0` / `v0.9.0` / `v1.0.0`（须你确认闸门后打）  
4. **SEC3** 登录认证（你要求最后做）

## 约束

SEC3 不恢复；不伪造专家标签或生产正确率；DEV `.env` 不提交密钥。
