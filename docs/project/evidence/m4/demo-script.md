# 演示脚本（约 7–10 分钟）

面向比赛现场；使用根 `package.json` 的 **demo CLI**（与 [deployment/demo.md](../../../deployment/demo.md) 一致）。**无登录步骤**（SEC3 延期）。合成/种子数据 only。

## 前置

```bash
cp .env.example .env   # 配置 DATABASE_URL；演示可用 AUDIT_AGENT_MODE=fake
bun install --frozen-lockfile
docker compose up -d postgres   # 及 redis/rustfs 若走 full profile
```

受管演示会生成 **`.demo.env`**（0600，勿提交）。以下命令默认 `bun --env-file=.env`（package.json 已带）。

## 时间线

| 时段 | 步骤 | 命令 / 操作 | 讲解要点 |
| --- | --- | --- | --- |
| 0:00–1:00 | 启动栈 | `bun run demo:up` → `bun run demo:ready` | 健康检查、迁移、种子；端口见 ready 输出 |
| 1:00–1:30 | 可选校验 | `bun run demo:check` 或 `curl …/api/health` | database/dispatcher；objectStore 可降级 |
| 1:30–2:00 | 主题 | Web 顶栏切换暗色/浅色 | M2 双主题；localStorage 记忆 |
| 2:00–4:00 | 队列与证据 | 打开 `/audit-cases` → 待复核案件 → 三栏证据与 Finding | 规则权威；码点证据 |
| 4:00–6:00 | 复核与整改 | 复核中心确认/驳回 → `/remediations` 看板 | 追加式 Revision；整改状态机 |
| 6:00–8:00 | 执行轨迹 | 案件「执行轨迹」/ Inspector：对话·轨迹·泳道 | 真实 Fake trace；缺失指标显示「未提供」 |
| 8:00–9:00 | 影子决策（可选） | 默认 off：打开 `/audit-cases/:id/decisions` 看空态说明 | 若 `DECISION_MODE=shadow`：宣读免责声明，**不改正式结论** |
| 9:00–10:00 | 质量口径 | 引用 `bun run verify` 与 M1 CI 四 job | 本分支摘要见 [verify-summary.md](./verify-summary.md) |

## 常用 CLI（package.json）

| 命令 | 用途 |
| --- | --- |
| `bun run demo:up` | 启动演示栈 |
| `bun run demo:down` | 停止 |
| `bun run demo:reset` | 事务化重置演示世界 |
| `bun run demo:seed` | 播种 |
| `bun run demo:verify` | 对运行中 API 验收 |
| `bun run demo:check` | 诊断 |
| `bun run demo:ready` | 等待就绪 |

## 故障备用

- 模型不可用：保持 `AUDIT_AGENT_MODE=fake`；讲轨迹结构，不讲实时推理。
- 对象存储/Redis 降级：配合 `/api/health` 讲 NFR-02。
- 数据库不可用：**停止演示**，修环境；不要用假数据继续。

长版分镜与评委 FAQ 见 [competition/DEMO-SCRIPT.md](../../../competition/DEMO-SCRIPT.md)。
