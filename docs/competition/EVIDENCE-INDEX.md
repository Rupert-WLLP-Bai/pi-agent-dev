# 部署与质量证据索引（EVIDENCE-INDEX）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。这是**单一证据目录**：每条声明在这里能找到出处。Main 拥有 `docs/project-management/evidence/` 的文件；本文只索引，不复制其内容。

## 1. 证据清单

| 声明 | 证据文件/位置 | 产生方式 | 上下文（commit/配置） |
| --- | --- | --- | --- |
| S0 基线审计 | `docs/project-management/BASELINE.md`、`evidence/s0-results.json` | 只读审计 + 独立 worktree 实测 | 输入 `d9a84a4`，提交 `a4c6119` |
| S1 契约验证 | `evidence/s1-verification.json` | 18 项契约测试 + 670 测试 | commit `6a59906` 基线 |
| 窄屏缺陷复现 | `evidence/s0-review-375.png`、`s0-review-1440.png` | 真实浏览器 375/1440 对照 | 同一合成案件 |
| 访问门行为（**历史记录**） | `evidence/s2-security.json` | HTTP + 隔离 PG：匿名 401/授权 200/登出 204/重放 401 | commit `1f33d99`；SSE 吊销见 `sse-revocation-smoke.json`（`b2033e1`）。**2026-10-17 认证延期后该实现已移除**：当前 API 无登录/Bearer/session 强制、无 `/api/session`，这两份 JSON 只证明延期前的实现曾通过验证 |
| 安全评审 | `evidence/security-review.json` | 发现项与修复记录（QCC 固定错误码、模型 basis 无原始诊断、SSE 关闭） | commit `b2033e1` |
| 全量质量门禁 | Main 提交记录（`b2033e1`） | `bun run verify` 693/0、78 文件、lint/typecheck | 迁移后隔离 PG；集成后全局计数以 Main 最终记录为准 |
| 真实 Pi 冒烟 | `evidence/real-pi-smoke.json` | 单合成样本 `equipment-lease`；请求端点/模型 + 环境凭据 | 29727 ms、42 步骤、Guard 通过、快照未变；provenance 守卫后复跑 30365 ms、同样 2 项 Guard 有效提案、快照不可变（`b2033e1`） |
| Laya CPU 冒烟 | `evidence/laya-cpu-smoke.json` | 本地 CPU 单请求；laya 0.4.7 `432312b…`/模型 `1720e3…` | 642 ms、未校准、cpu/线程 4 |
| 密钥轮换 | `evidence/key-rotation-smoke.json` | 新迁移库 dry-run/apply；错库拒绝；损坏行回滚 | commit `cd24aac` |
| 存储边界 | `evidence/storage-boundary-smoke.json` | S3 归属/严格模式/local 不经过 S3 读 | 迁移 `0018`（`f7ce8d1`） |
| 启动安全 | `evidence/startup-security.json` | demo/production secret 前置校验；旧明文重封 2→0 幂等 | commit `cd24aac` |
| 缓存失败与隐私回归 | `evidence/cache-failure-smoke.json` | Redis 不可达 1.5 s 超时/不重试，观测 33 ms 返回 disabled cache；7 项隐私/降级回归通过 | commit `2d63f15` 及后续安全切片；最终计数待集成 |
| 金额链实测 | `docs/research/2026-09-14-ict-项目卷宗现状调研.md` §6 | 合成卷宗（1 xlsx + 2 docx）端到端 | 0.56 s 冷启动、3 项比对、2 处手工合计 |
| OCR 真实耗时 | 同上 §5 | 24.6 MB 扫描件、视觉模型、`OCR_SCALE=2`、并发 3 | 396 s、990 块/26041 字 |
| Pi 1.2 升级 | `docs/research/2026-10-14-pi-1.2-upgrade.md` | 真实模型完成审计 + 协议回归 | 69170 ms 样本、版本锁 1.2.0 |
| E2E 基线 | S0 记录 | `CI=true ... bun run acceptance` | 37/38；失败用例 `audit-case.spec.ts:191` |
| S2 合并集成检查点 | Main 观察（`a849b29`） | `bun run verify` | 835 通过/0 失败；其后有未提交决策契约修订，最终计数以 S3 为准 |

## 2. 复现命令对照（证据 → 命令）

| 证据 | 复现命令 | 注意 |
| --- | --- | --- |
| 质量门禁 | `bun run verify` | 数据库不可达时部分测试 SKIP，不是完整验证 |
| 单元/集成 | `DATABASE_URL=<独立库> bun run test` | 用独立迁移库，勿用开发/演示库 |
| 浏览器验收 | `CI=true PLAYWRIGHT_DATABASE_URL=<独立库> PLAYWRIGHT_API_PORT=3023 PLAYWRIGHT_WEB_PORT=5193 bunx playwright test` | 单 worker；端口/库都可覆盖 |
| 访问门 | 见 `docs/engineering/acceptance-criteria.md` §2.2（**已延期**：无命令可复现；历史证据须配 commit 上下文） | 延期前需 `API_ACCESS_TOKEN`；当前无该语义 |
| 真实模型冒烟 | Main 执行的脚本（归档证据 JSON） | 只发合成合同；凭据来源为请求值 + 环境变量 |
| Laya CPU | Main 执行的本地 smoke（归档证据 JSON） | 需本地 Python/torch CPU 环境 |
| 密钥轮换 | `bun run secrets:rotate`（默认 dry-run） | `--apply` 才写；库名必须匹配 |
| 演示栈 | `docker compose up --build` → `:8080` | API 自迁移；fake 模式免凭证 |

## 3. 待归集证据（Main/QA/Infra 负责，Docs 不回填未产生的数字）

| 项 | 负责 | 状态 |
| --- | --- | --- |
| 覆盖率工件（行/函数分开；分支不可测标null） | QA | 已产出（`de7ea2d`：`artifacts/qa/coverage/lcov.info`）；统一运行待S3 |
| 真实 Redis/S3 故障与恢复集成 | Infra + QA | 用例已入树（`de7ea2d`）；真实服务统一运行待S3 |
| 字段级出网抓包（模型请求无敏感标识） | QA | 待归集 |
| 两次 reset + 非 demo 哨兵 | Infra + QA | 脚本与保护已入树（`908cb5a`+`a849b29`）；对照运行待S3（reset遗漏修正由Main进行中） |
| 第三方复现记录（K3） | Infra | 待归集 |
| 影子 off/shadow 对照运行 | AI + QA | 代码已合并（`a6ec041`）；对照运行待S3 |
| 修正后的 E2E 全绿记录 | QA | rerun 契约已重写（`de7ea2d`）；全绿记录待S3 |

## 4. 使用规则

1. 汇报/答辩引用证据时，同时引用**上下文**（commit、库、模式、样本量）。
2. 单样本证据不得表述为基准或一般结论。
3. 不同 commit 的数字不可平均、不可合并成"总体通过率"。
4. 本文条目与 Main 的 `evidence/` 目录一一对应；新增证据由 Main 归档后在此登记。
5. 2026-10-17 起访问门/认证相关证据（`s2-security.json`、`sse-revocation-smoke.json`、`security-review.json`）是**历史记录**：认证已延期到最后实现，引用时必须带"延期前"上下文，不得表述为当前能力。
