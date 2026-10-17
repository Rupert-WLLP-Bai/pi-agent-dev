# 需求—实现—测试 RTM（精简）

维护：M4-B03 / Q1。基准日：2026-10-17。完整 SRS 见 [engineering/requirements.md](../../../engineering/requirements.md)；本表只列**主链路**，不混同 golden 与独立 E2E。

| 需求主题 | 需求 ID（SRS） | 实现 | 测试 / 证据 |
| --- | --- | --- | --- |
| 合同上传与审计案件 | FR-01 | `apps/api/src/routes/audit-cases.ts`、dispatcher | `tests/acceptance/upload.spec.ts`；M1 browser.json |
| 确定性规则 + Guard | FR-02, FR-05 | `packages/audit` rules、`proposal-guard.ts` | `golden-set.test.ts`、`proposal-guard.test.ts` |
| 合同立场 | FR-03 | `contract-stance.ts` | 包内单测 |
| Pi Agent 与六工具 | FR-04 | `packages/pi-agent` | runtime/tools 测试；M1 Fake trace |
| 人工复核 | FR-06 | reviews 路由 + web | `review-center.spec.ts` |
| 整改闭环 | FR-07 | remediations 路由 + web | `remediations.spec.ts` |
| 规则治理 | FR-08 | rules 路由、rule-repository | rules 相关单测与 acceptance |
| 运行轨迹 / Inspector | FR-09 | trace 持久化、web trace/inspector | trace 测试；TRACE-EVENT-CONTRACT |
| 重新审计 | FR-10 | rerun 路由 | API 单测（DB 层 skip 无 PG 时） |
| 卷宗金额链 | FR-11 | dossier 路由 | 包内 consistency 测试 |
| OCR 可配 | FR-12 | `document/ocr`、settings 页 | ocr 设置单测；E2E 待归集 |
| 健康与降级 | FR-13, NFR-02 | `/api/health`、cache/storage 降级 | health 测试；M1 faults |
| LLM provider 管理 | FR-14 | `llm/` 仓库 | llm-providers 测试 |
| Demo 种子与世界 | FR-15, FR-19 | `demo/`、`scripts/demo/cli.ts` | seed 测试；M1 demo reset |
| 影子决策 | FR-17–18 | `apps/api/src/decision/*` | `scripts/decision/evaluate.ts`；M3 acceptance-checklist |
| 决策 UI | FR-20 | `decision-advice-panel.tsx` | web 组件/路由测试 |
| 访问控制 | FR-16 | — | **延期 SEC3**；authentication-deferred 证据 |
| 双主题 UI | M2 | `theme-mode.ts`、`theme-provider.tsx` | `theme-mode.test.ts` |
| CI | Q5 | `.github/workflows/ci.yml` | github-ci-2026-10-17.json |
| 分层 verify 入口 | Q4 | `bun run verify`、`scripts/qa/report.ts` | M4 verify-summary；M1 release-gate |

**未映射为 DONE 的项**：真实模型全路径 E2E（M4-A02）、专家决策 gold（M3-B01 BLOCKED）、生产性能 KPI（R8 测量计划）。
