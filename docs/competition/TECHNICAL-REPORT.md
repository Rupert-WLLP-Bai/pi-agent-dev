# 技术报告与推广复制（TECHNICAL-REPORT）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。本文服务两个对象：技术评委（实现与证据）与潜在复制方（适配成本与前提）。

## 1. 实现摘要

- **架构**：Bun + TypeScript monorepo（`apps/web`、`apps/api`、`packages/audit`、`packages/pi-agent`）；Elysia REST/SSE/OpenAPI；Drizzle + PostgreSQL 18；RustFS（S3）存原文、可回退本地；Redis 仅主体核验缓存；嵌入式 Pi 1.2.0。详见 [C4 视图](../engineering/c4-and-adr-index.md)。
- **领域**：Contract Document IR、Fact Builder、19 条确定性规则、Contract Stance、Proposal Guard、证据 locator（码点区间）、Audit Snapshot 不可变、Finding Revision 追加。
- **Agent**：六工具白名单；资源发现关闭；thinking `off`；轨迹含嵌套调用与轮次 token（ADR-0004/0005）。
- **影子（S2）**：DecisionRequest/Advice/Feedback 契约 + TypeBox 校验；provider disabled/fake/laya-cpu；默认 off；持久化/worker/决策 UI 已随切片合并（`a6ec041`、`cc942b2`）；本地 Laya CPU 冒烟通过（单样本）。off/shadow 对照与详情授权回归在 S3。
- **访问控制（2026-10-17）**：认证（登录口令、Bearer、Cookie 会话、`/api/session`）已延期到最后实现；当前无任何认证强制，仍保留跨站写入拒绝、`X-Operator` 归属标注、日志脱敏、凭据密封、出网与 locator 边界。

## 2. 关键工程决策与代价

| 决策 | 收益 | 代价/限制 |
| --- | --- | --- |
| 规则权威、Agent 只提议 | 结论可证明、可回溯 | Agent 价值受限（不做开放问答） |
| 参数版本化而非规则 DSL | 发布门禁可执行、golden 回归可复用 | 加规则必须改代码 |
| PG `SKIP LOCKED` 队列 | 无新基础设施 | 单实例假设；多副本需重新评估 |
| RustFS + 本地回退（仅开发 opt-in） | 数据不出域可选、写入结果诚实 | 严格模式（demo/production）下 S3 故障即失败；两套后端行为需分别验证 |
| 访问控制 | **已延期（2026-10-17 用户指示）**：无登录/Bearer/session 强制，部署靠网络入口隔离 | 实现与维护成本低；当前边界必须如实写明 | 无身份认证，任何人可访问地址即可读写全部 API；历史口令门实测（`s2-security.json`）只作历史记录 |
| 影子默认 off + 未校准标记 | 不污染正式结论 | 影子价值需 S2 完成后评估 |
| 不做 RAG/K8s/OTel | 复制成本低 | 大规模检索/编排场景不覆盖 |

## 3. 已验证证据（按 commit 归档）

| 证据 | 位置 | 内容 |
| --- | --- | --- |
| 单测/typecheck/lint | commit `b2033e1`（Main 记录） | 693 通过/0 失败，78 文件；S2 五切片合并后集成检查点 `a849b29` 835 通过/0 失败（Main 观察；其后未提交决策契约修订待收尾，最终以 S3 为准） |
| 分层测试/覆盖率基线 | `de7ea2d` | 冻结基线 670/0；行 81.1%/函数 82.8%；分支不可测（Bun LCOV 无 BRDA） |
| 访问门/SSE 吊销（**历史记录**） | `evidence/s2-security.json`、`evidence/sse-revocation-smoke.json` | 匿名 401/授权 200/登出 204/重放 401；登出关闭流；到期前 250 ms 的流在 249 ms 关闭，无原始错误日志。**2026-10-17 认证延期后该实现已移除**：当前无登录/Bearer/session，这两份只证明延期前实现曾通过验证 |
| 安全评审修复 | `evidence/security-review.json` | QCC 固定错误码且模型 basis 无原始诊断；`subjectVerificationProvider` 仅授权 fixture 上下文 |
| 真实 Pi 单样本 | `docs/project-management/evidence/real-pi-smoke.json` | 29727 ms、42 步骤、Guard 通过；provenance 守卫后复跑 30365 ms（`b2033e1`） |
| Laya CPU 单样本 | `docs/project-management/evidence/laya-cpu-smoke.json` | 642 ms、未校准、cpu/线程 4 |
| 密钥轮换/启动安全 | `docs/project-management/evidence/{key-rotation-smoke,startup-security}.json` | dry-run/apply、错库拒绝、重封幂等 |
| 决策契约测试 | commit `6a59906` | 18 通过/0 失败 |
| 金额链单样本 | [ICT 调研 §6](../research/2026-09-14-ict-项目卷宗现状调研.md) | 3 项比对、2 处手工合计标记 |
| E2E 基线 | S0（`a4c6119`） | 37/38；1 例契约过期待修正 |

## 4. 推广成熟度矩阵

| 场景 | 成熟度 | 需要什么 |
| --- | --- | --- |
| 市/区县公司采购合同审查 | 立即可用（单实例） | PostgreSQL；LLM 可 fake；规则集已覆盖常见采购风险 |
| 网络建设工程合同 | 配置后可用 | 保证金/质保金规则已在目录；行业专属条款需新增规则 |
| 政企/ICT 服务合同 | 配置后可用 | 数据条款类检查可借鉴已归档 skill 方法（未接入运行时） |
| 采购供应链台账 | 需业务改造 | 金额链为无状态核对；接入台账需定制 |
| 法务合规知识库 | 需业务改造 | 知识 manifest 已归档；接入需版本化管理设计 |
| 运维外包/服务合同 | 立即可用（通用条款） | 按立场分档即可 |
| 多部门/多组织 | 需业务改造 | 无多租户；规则参数可按组织复制部署实例 |

## 5. 复制条件清单（第三方视角）

1. **基础设施**：PostgreSQL 18；可选 RustFS/任意 S3；可选 Redis；Docker + Compose。
2. **模型**：任一 OpenAI 兼容网关（Pi）；视觉模型端点（OCR vlm）或 MinerU 4.x 服务；本地 Laya（影子，可选）。
3. **配置**：`.env.example` 全量注释；demo/production 需 ≥32 位加密 secret（`LLM_KEY_ENCRYPTION_SECRET`）。**`API_ACCESS_TOKEN` 是 legacy 变量，对当前 API 无效果**：认证已延期（2026-10-17），不设置也能启动。
4. **规则适配**：参数可配；新规则需开发 + golden 案例（工作量按规则计）。
5. **数据**：演示用合成；生产接入需评估出网策略与脱敏需求。
6. **不做**：不提供多租户/SSO；不承诺生产合规认证；**当前不提供身份认证**（登录/Bearer/session 已延期到最后实现，2026-10-17 用户指示），部署需自行网络隔离。

## 6. 已知限制（复制方必须知道）

- 单实例；重启后任务恢复依赖 PG 租约与启动时的 stale 状态处理，**无跨实例故障转移**。
- 375px 窄屏复核可达性已随切片修复（`cc942b2` 行为验收入树）；截图归档与统一回归在 S3。
- 影子层代码已合并但 off/shadow 对照、影子详情授权与故障隔离统一回归在 S3；S3 前演示按"已实现待验收"对待。
- OCR 视觉模型对 24.6 MB 扫描件实测 396 s（单样本），长文档演示需预跑。
- 真实 Redis/S3 故障集成本机未跑（端口未监听）；字段级出网抓包、第三方复现记录待 QA/Infra 归集。

## 7. 后续路线（与 P2 边界一致）

- P1 收尾：决策契约修订收尾、off/shadow 对照与影子详情授权回归、全量 Laya 评测、真实依赖统一回归、视觉重设计验收（V1 行）。
- P2（明确延期）：完整置信度校准研究、高级反馈分析、多模型对比实验。
- 不做：RAG、消息队列、K8s、OTel 全家桶、SSO/RBAC/多租户（除非用户明确批准范围变更）。
