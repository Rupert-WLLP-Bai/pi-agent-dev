# 验收判据与证据索引（R2 配套）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。
> 每条判据给出**可执行命令或可观察行为**与**证据位置**；证据不存在时明确写"待补"，不用规划冒充结果。

## 1. 阶段门禁（S0–S4）

| 阶段 | 判据 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| S0 基线 | Git 历史重建、环境实测、已完成/缺口矩阵、风险表 | `docs/project-management/BASELINE.md`、`evidence/s0-results.json`、提交 `a4c6119` | 完成（保留 1 个 E2E 失败与 375px 缺陷，已定位 Owner） |
| S1 契约 | G1–G7：版本化 DTO、错误/幂等、隐私/授权/保留、迁移回滚、Laya 前置、任务矩阵、worktree 隔离 | `docs/architecture/INTEGRATION-CONTRACT.md`、`evidence/s1-verification.json`（18 测试、670 测试） | 完成（契约层；实现层属 S2） |
| S2 实施 | 每个任务有实现 + smoke + 回滚说明 | 各 Owner 交回；`1f33d99` 安全切片已实测 | 进行中 |
| S3 集成 | 统一 verify、集成、E2E、Docker、降级、幂等；`docs/quality/RELEASE-READINESS.md` | 待 Main 执行 | 未开始 |
| S4 交付 | 真实证据、复现指南、Gantt 历史/未来分离、竞品与推广 | 本文档 + `docs/competition/` | 进行中 |

## 2. 可执行验收命令（按角色）

### 2.1 质量闸门（任何提交前）

```bash
bun run verify        # lint + 两轮 typecheck + 单元测试
bun run test          # 仅单元/集成（bun test packages apps）
bun run acceptance    # Playwright（默认自动以 fake 模式起服务）
```

实测基线（S0/S1，独立迁移库）：`bun run verify` 670 通过/0 失败（S1，75 文件、1938 断言）；`CI=true ... bun run acceptance` 38 例中 37 通过/1 失败（失败用例 `tests/acceptance/audit-case.spec.ts:191`，属验收契约过期，QA 已列修正项）。**这些数字对应各自 commit 与库，不能外推到其它配置。**

### 2.2 访问门（安全切片，已实测）

```bash
# 匿名访问受保护资源 → 401
curl -i http://localhost:3000/api/audit-cases
# 会话发现
curl -i http://localhost:3000/api/session
# 登录（设置 HttpOnly cookie）
curl -i -c cookies.txt -H 'content-type: application/json' \
  -d '{"token":"<API_ACCESS_TOKEN>"}' http://localhost:3000/api/session
# 授权读取 → 200
curl -i -b cookies.txt http://localhost:3000/api/audit-cases
# 登出 → 204
curl -i -b cookies.txt -X DELETE http://localhost:3000/api/session
```

证据：`docs/project-management/evidence/s2-security.json`（含重放 cookie 401）；运维说明：`docs/runbook/access-control.md`。

### 2.3 真实模型冒烟（单合成样本）

- 证据（Main 归档）：`docs/project-management/evidence/real-pi-smoke.json`。
- 口径：模型 `panda-local/cqmoma/cqcm/deepseek-v4-flash`（请求值 + 环境凭据，`providerConfigSource: requested endpoint/model with environment credential`），合成样本 `equipment-lease`，29727 ms、42 轨迹步骤、两项提案过 Guard、快照未变。**不得**据此声称一般质量或效率。

### 2.4 本地 Laya CPU 冒烟（单请求样本）

- 证据（Main 归档）：`docs/project-management/evidence/laya-cpu-smoke.json`；laya 0.4.7（code `432312b…`）、多语模型 revision `1720e3…`、torch 2.14.1+cpu、Python 3.12.15。
- 口径：单条 3 问中文请求 200、642 ms、input 247/output 0、未校准；health 报实际 cpu、仅加载该模型、线程 4、无 GPU。**不得**据此声称准确率或吞吐。

## 3. 行为判据（不依赖命令的验收）

| 域 | 判据 | 证据形式 |
| --- | --- | --- |
| 规则权威 | 同一输入 off/shadow 两种模式下正式规则结论、Finding、复核、整改完全一致 | 对照运行报告（QA 归集） |
| 影子隔离 | provider/队列/超时故障注入后，成功案件不转 FAILED，正式数据零变化 | 故障注入记录 |
| 重新审计 | 旧案快照/发现/复核/整改字节级不变；新案新 Run 同 Source Record/Revision | E2E + DB 断言 |
| 重置安全 | 两次 reset 后受管实体数量/稳定 ID/hash 一致；非 demo 哨兵行数不变；生产/未知环境拒绝 | reset 前后计数与哨兵查询 |
| 降级 | S3/RustFS 未配置或不可达时原文落本地且 locator 记录真实后端；Redis 不可达不失败审计 | health 输出 + 业务流程走查 |
| 隐私 | 公开 DTO 无完整请求/原始响应/身份/gold；模型请求体无敏感标识 | 响应体断言 + 抓包（QA） |

## 4. 已知未通过项（不得在汇报中省略）

1. `tests/acceptance/audit-case.spec.ts:191`：旧"重新运行 Agent"契约与新 rerun 语义冲突（S0 实测失败，QA 修正中）。
2. 375px 窄屏复核面板与风险导航隐藏、可见复核操作 0（S0 截图两份；UX 修复中）。
3. 真实 Redis/S3 故障集成、字段级出网抓包、覆盖率工件、第三方复现记录均**未有本次运行证据**，状态为待补。

## 5. 汇报口径

- "已完成"只用于有本节证据的状态；"已实现待验证"用于代码在而运行证据缺失的项。
- 所有计划日期（见 `gantt.md` §3）不得进入历史叙述。
