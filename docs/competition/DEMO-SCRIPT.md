# 演示剧本（DEMO-SCRIPT）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。
> **纪律**：只用**合成/脱敏**合同；每步注明页面、操作、预期与失败时的备用话术；未实现的步骤标"预研"，不假装完成。所有被引用能力以代码与实跑证据为准（证据列在每节末尾）。

## 0. 演示前检查（任何时长都先做）

```bash
bun --env-file=.demo.env scripts/demo/cli.ts up      # 受管演示栈：启动、迁移、登记演示环境、播种（.demo.env 由 up 生成，0600）
bun --env-file=.demo.env scripts/demo/cli.ts verify  # 对运行中的 API 做启动验收
curl -s http://localhost:3000/api/health | jq .      # status=ok
```

最小开发档（无模型凭据、原件落本地）可用根 `.env`：`bun --env-file=.env scripts/demo/cli.ts up|down|reset|seed|verify|check`；compose 兜底路径（`docker compose up -d postgres rustfs redis rustfs-init` + `docker compose exec api bun run seed:demo`）仍然有效。**演示 CLI 的各入口以代码与 [docs/deployment/demo.md](../deployment/demo.md) 为准，统一回归（S3）完成前按"已实现待验收"对待。**

预期：`status=ok`、`database=true`、`dispatcher=true`；`objectStore`/`redis` 可降级（`ok` false 不阻塞）。

**若访问门已启用**（`API_ACCESS_TOKEN`）：浏览器会要求访问口令，输入后进入（Bearer 或登录会话，见 [access-control](../runbook/access-control.md)）。**口令不进 URL、不写进任何共享材料**。

失败兜底：任一依赖不可用 → 演示降级路径本身就是卖点（讲"对象存储/缓存可降级"）；数据库不可用 → 停止演示并修环境，不要继续。

## 1. 三分钟版（评委快速版）

| 步 | 页面/操作 | 预期 | 讲解要点 |
| --- | --- | --- | --- |
| 1 | `/audit-cases` →「新建审计」→ 加载演示合同（设备租赁，预付款 50%）→ 提交 | 案件进入队列并自动运行（fake 模式免凭证） | 规则权威：预付款 50% > 制度上限 30% 由确定性规则判定 |
| 2 | 案件详情 → Finding 列表 → 点开 HIGH 风险 | 显示规则评估、严重度、**证据定位**（原文块 + 码点区间） | 每条结论可回到具体字符 |
| 3 | 同一 Finding →「确认」 | 生成追加式 Finding Revision；自动出现整改项 | 人工决策不可覆盖，只追加 |
| 4 | `/remediations` → 看板 | 新整改项在"待整改" | 确认风险 → 整改闭环 |
| 5 | `/audit-cases/:id/trace` | 展示真实工具调用（规则评估/证据读取）与轮次 | Agent 做了什么、读了什么，全程留痕 |
| 6 | `/rules` → 打开某规则详情 | 参数版本（草稿/已发布/已退役）+ 最近验证 | 规则可治理：没过验证不能发布 |

收尾一句：**"AI 提建议，规则做判定，人做决定，全程可追溯。"**

失败兜底：模型端点不可用时改用 `AUDIT_AGENT_MODE=fake`（容器默认）继续；不讲实时推理，改讲轨迹结构。

## 2. 五分钟版（三分钟 + 治理与隐私）

在 §1 全部步骤后追加：

| 步 | 页面/操作 | 预期 | 讲解要点 |
| --- | --- | --- | --- |
| 7 | `/rules/:id/versions` → 新建草稿 → 改阈值 →「验证」 | 验证跑黄金案例；失败时发布按钮禁用并给出原因 | 发布门禁是硬机制，不是提示 |
| 8 | 故意提交一条不带证据的提案（开发环境脚本/API） | 被 Proposal Guard 拒绝，不产生 Finding | 演**拒绝路径**，这是差异点 |
| 9 | `/settings/providers` → 查看 provider 列表 | API key 只显示掩码；表空时回退 `XYG_*` | 密钥不返回、不进浏览器 |
| 10 | `/settings/ocr` | 关闭/视觉模型/MinerU 三选一；未配置即明确不可用 | OCR 可插拔、可降级 |
| 11 | `/integrations` + `/api/health` | 每个依赖的真实后端与就绪状态 | 可观测与降级语义 |

失败兜底：Guard 拒绝演示需要受控环境；不能现场改代码——提前准备好请求脚本，失败就口头讲解代码路径（`proposal-guard.ts`）。

## 3. 八分钟版（五分钟 + 影子决策与隐私工程）

在 §2 全部步骤后追加：

| 步 | 页面/操作 | 预期 | 讲解要点 |
| --- | --- | --- | --- |
| 12 | 打开案件决策面板 | 显示影子建议、来源、**未校准**标识；没有建议时显示"未提供"而非 0% | 影子只是建议；未校准即标记 |
| 13 | 影子反馈入口 | 提交"接受/驳回/需复核"；注明"仅评估，不改变审计结论" | 反馈 append-only，独立于 Finding Review |
| 14 | 对比演示：同一合同 off vs shadow | 正式规则结论、Finding、复核、整改完全一致 | 影子故障/存在都不污染正式链路 |
| 15 | 隐私口径讲解（配合 `audit-data-policy.ts`） | 原始合同默认不出网；`LLM_INTERNAL_DATA_ORIGINS` 默认空；合成内容以 hash 证明 | 数据边界是代码强制的 |
| 16 | 访问门演示 | 匿名 401 → 登录 200 → 登出 204 | 单工作区门禁（非 SSO/RBAC） |
| 17 | 收尾：`bun run verify` 数字 + 一键复现命令 | 单测 693/0（commit `b2033e1`）；合并后集成检查点 835/0（`a849b29`，Main 观察）；最终统一计数以 S3 为准，不同 commit 数字不可混用 | 质量证据可复跑 |

**步骤 12–14 的就绪度**：决策层代码与持久化/worker/UI 已随 S2 切片合并（`a6ec041`、`cc942b2`，含未提交契约修订待 Main 收尾）；off/shadow 对照与故障隔离的**统一回归在 S3**。S3 通过前该环节按"已实现待验收"对待；不得用 Fake 冒充实时影子。

## 4. 技术版（7–10 分钟，面向技术评委）

结构：架构 → 数据流 → 不变量 → 治理 → 隐私 → 复现。

1. **架构**（1 min）：C4 Context/Container（`docs/engineering/c4-and-adr-index.md`）：单实例、进程内 dispatcher、PG 队列 `SKIP LOCKED`、Redis 仅核验缓存、RustFS 可降级。
2. **数据流**（2 min）：上传 → 原件存储（locator 记录真实后端）→ 解析（txt/docx/pdf/xlsx/OCR）→ IR → Facts → 主体核验 → 规则评估 → 不可变快照 → Pi 六工具 → Guard → Finding Revision → 人工复核 → 整改。
3. **不变量**（2 min）：快照不可变；修订只追加；码点 offset；影子不是真值源；rerun 新建案件、旧案保留（`409 case_active`/`rerun_already_active`）。
4. **治理**（1.5 min）：规则参数版本化 + 发布门禁；轨迹含嵌套调用与轮次 token（ADR-0004/0005）。
5. **隐私与安全**（1.5 min）：访问门（实测 401/200/204）；出网默认禁止；最小脱敏输入；key 密封 + 轮换 dry-run 默认。
6. **复现**（1 min）：clone → `.env`（可空）→ compose → migrate → `bun run verify` → `docker compose up --build`。

失败兜底：每一步都可回到"代码位置 + 测试名字"口头讲解；现场不调试。

## 5. 案例设计（合成）

| 案例 | 覆盖 | 位置 |
| --- | --- | --- |
| 设备租赁（预付款 50% + 异地管辖） | 多维冲突、默认 E2E 样本 | `packages/audit/src/demo-contracts.ts`（`equipment-lease`） |
| 全合规合同 | 通过路径、无 finding 直接完成 | demo-contracts 合规样本 |
| 跨案历史关联 | 同一相对方历史超限挂到新合同 | demo-scenarios `cross-case-missed-link` |
| 合同版本 diff | 70% → 20% 修订前后对比 | demo-scenarios `contract-version-diff` |
| 主体红线 | 条款干净但相对方失信 | demo-scenarios `subject-red-line` |
| 背靠背付款 | 法释〔2024〕11 号口径 | demo-scenarios `back-to-back` |
| 误报对照 | 历史误报 → 需人工复核 | demo-scenarios `false-positive-contrast` |
| 金额链卷宗 | 1 xlsx + 2 docx 跨文档比对 | `/dossier-review`（合成卷宗） |

**不使用**真实客户名与真实金额做演示（与早期调研"可用真实数据"的设想不同：本轮以合成/脱敏为默认，避免敏感数据进入演示环境与录屏）。

## 6. 证据索引（演示中可点开）

| 声明 | 证据 |
| --- | --- |
| 单测全绿 | commit `b2033e1`，693/0（Main 验证记录；78 文件）；S2 合并检查点 `a849b29` 835/0（Main 观察，最终以 S3 统一运行为准） |
| 访问门行为 | `docs/project-management/evidence/s2-security.json` |
| 真实 Pi 单样本 | `docs/project-management/evidence/real-pi-smoke.json` |
| Laya CPU 单样本 | `docs/project-management/evidence/laya-cpu-smoke.json` |
| 密钥轮换 | `docs/project-management/evidence/key-rotation-smoke.json`、`startup-security.json` |
| 规则/Guard/复核回归 | `bun run test` 各包用例 |
| 金额链实测 | [ICT 调研](../research/2026-09-14-ict-项目卷宗现状调研.md) §6 |

## 7. 演示纪律

1. 不现场改数据库/规则状态（除非 §2 步骤 7 的受控草稿）。
2. 不宣称未运行路径（影子未就绪就跳过）。
3. 所有数字只引用其 commit 与配置上下文。
4. 录屏/截图不得包含真实口令、真实合同或真实主体信息。
