# 离线可复现脚本（REPLAY-SCRIPTS）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。
> **纪律**：所有脚本只用**合成数据**、不访问外部网络（除本地回环）、不需要 LLM 凭证（fake 模式）。每支脚本给出**预期输出**与**失败判定**；未实现的步骤标注等待 Infra/QA 交付，不写占位命令。

## 1. 前置（所有脚本共用）

```bash
# 一次性
cp .env.example .env                    # LLM 可留空
bun install
docker compose up -d postgres rustfs redis rustfs-init
cd apps/api && bunx drizzle-kit migrate && cd ../..
```

健康检查（预期 `status=ok`）：

```bash
curl -s http://localhost:3000/api/health
```

**无需任何认证头**：2026-10-17 起登录/Bearer/`/api/session` 会话已延期到最后实现，当前 API 不校验 `API_ACCESS_TOKEN`，直接请求即可。历史"若 `API_ACCESS_TOKEN` 已设置则带 Bearer/cookie"的口径已作废。

## 2. 3 分钟脚本：核心闭环（合成合同）

```bash
# 1) 重置演示世界（受控；仅 demo/test 库）
docker compose exec api bun run seed:demo

# 2) 提交合成合同（与内置演示样本 equipment-lease 同构：预付款 50% + 成都管辖）
CONTRACT=$(cat <<'EOF'
重型设备租赁合同
甲方：重庆华盛贸易有限公司（承租方）
乙方：成都建工集团有限公司（出租方）
第一条 合同标的
乙方向甲方出租塔式起重机两台与施工电梯一台，租赁期为十二个月。
第二条 合同价款
合同总价为人民币壹佰伍拾万元整（小写：1,500,000.00元），含增值税。
第三条 支付方式
甲方应在合同签订后五日内支付合同总价50%作为预付款，其余按月结算。
第五条 违约责任
任何一方违反本合同约定，应向守约方支付合同总价5%的违约金。
第七条 合同终止
任一方严重违约且经书面催告后十五日内未纠正的，守约方有权终止本合同。
第八条 争议解决
因本合同引起的争议，双方应友好协商解决；协商不成的，向成都人民法院提起诉讼。
签订日期：2026年9月28日
EOF
)
curl -s -X POST http://localhost:3000/api/audit-cases \
  -H 'content-type: application/json' \
  -d "{\"source\":\"text\",\"contractText\":$(printf '%s' "$CONTRACT" | bun -e 'process.stdout.write(JSON.stringify(await Bun.stdin.text()))')}"
```

预期：`202` 与 `{"id":"<caseId>","status":"PENDING"}`；dispatcher 自动领取运行（容器默认 `AUDIT_AGENT_MODE=fake`），产生 HIGH 预付款冲突 + MEDIUM 管辖冲突两条 finding；页面 `/audit-cases` 可见。

人工复核（预期 200，追加式修订；`ACCEPTED` 会打开整改项。`X-Operator` 必须为 ASCII：服务端与浏览器 fetch 都按 Latin1 传输头，中文操作者名按前端同款 `encodeURIComponent` 编码）：

```bash
curl -s -X POST http://localhost:3000/api/findings/<findingId>/reviews \
  -H 'content-type: application/json' -H 'X-Operator: %E6%BC%94%E7%A4%BA%E5%91%98' \
  -d '{"decision":"ACCEPTED","reason":"与制度上限比对确认超限"}'
```

整改看板（预期：`columns` 四列 + `total`；新整改项在 `pending` 列）：

```bash
curl -s http://localhost:3000/api/remediations | bun -e 'const b=await Bun.stdin.json(); console.log(b.total, b.columns.map((c) => `${c.status}:${c.items.length}`).join(" "))'
```

失败判定：202 后无 finding → 检查 `agentMode` 与规则启用状态；409 → 并发/重跑保护（语义符合预期时不算失败）。

## 3. 5 分钟脚本：治理与隐私面

```bash
# 规则列表（预期 19 条；响应为数组，每项含 status 与 enabled）
curl -s http://localhost:3000/api/rules | bun -e 'const r=await Bun.stdin.json(); console.log(r.length)'

# 模型服务（预期 key 只返回掩码/存在性）
curl -s http://localhost:3000/api/llm-providers

# OCR 设置（预期单行配置；未配置时 provider=off 且探针报告原因）
curl -s http://localhost:3000/api/ocr-settings
# 轻量只读就绪探测（GET /probe 不写入最近检查结果）
curl -s http://localhost:3000/api/ocr-settings/probe
# 需要更新"最近检查"状态时用 POST /test（同一探测，会记录结果）
curl -s -X POST http://localhost:3000/api/ocr-settings/test

# 访问控制现状（预期：匿名 200，无认证）
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/audit-cases
```

失败判定：规则数不是 19 → 代码与文档漂移，按 README 校正流程处理。**访问门已延期（2026-10-17）**：匿名返回 200 是预期，不再作为回归失败；若返回 401 说明运行的是延期前的旧进程。

## 4. 8 分钟脚本：影子、隐私与证据链

```bash
# 影子决策读取（S2 就绪后；默认 off 时读取历史不受影响）
curl -s http://localhost:3000/api/audit-cases/<caseId>/decisions

# 反馈幂等（S2 就绪后；预期同键同体重放返回同一事件，异体 409。X-Operator 同样须为 ASCII 百分号编码）
curl -s -X POST http://localhost:3000/api/decisions/<decisionId>/feedback \
  -H 'content-type: application/json' -H 'Idempotency-Key: demo-1' -H 'X-Operator: %E6%BC%94%E7%A4%BA%E5%91%98' \
  -d '{"schemaVersion":1,"decision":"accepted","reason":"与规则一致"}'
```

**就绪度**：decisions 路由与反馈由 AI 在 S2 交付（本工作树基线中尚不存在该路由）；未就绪时本段只讲契约（`packages/audit/src/decision.ts`）与 Laya CPU 冒烟证据，不执行、不宣称。

证据链走查（预期：定位器带 `contractDocumentHash`/`blockId`/`startOffset`/`endOffset`/`quotedText`；复核修订只追加）：

```bash
curl -s http://localhost:3000/api/audit-cases/<caseId> | bun -e 'const c=await Bun.stdin.json(); const s=JSON.stringify(c); const i=s.indexOf("DOCUMENT_SPAN"); console.log(i >= 0 ? s.slice(Math.max(0, i - 80), i + 320) : s.slice(0, 400))'
```

注：案件详情的具体字段名以 `AuditCaseDetail` DTO 为准；上面用 `DOCUMENT_SPAN` 定位器常量搜索，避免写死可能不存在的字段路径。

## 5. 失败回退演示（failure fallback）

| 场景 | 操作 | 预期（可观测） | 讲解点 |
| --- | --- | --- | --- |
| Redis 不可达 | `docker compose stop redis` 后跑一次审计 | 核验直连 provider/fixture；缓存路径 1.5 s 超时返回 disabled；审计不失败 | 降级不静默（`cache-failure-smoke.json`） |
| 对象存储不可用（严格模式） | `docker compose stop rustfs` 后上传 | **明确失败**（写入未确认不得当作成功），不静默落本地 | demo/production 默认严格：S3 不可达必须报错 |
| 对象存储不可用（显式本地回退） | 仅在显式选择 `s3-fallback-local` 的本地开发配置下重复上一步 | 原文写本地 `UPLOAD_DIR`；locator 记录真实后端；health 显示 `objectStore.ok=false` | 回退是**显式 opt-in**，不是默认行为 |
| LLM 不可达 | 清空 provider/`XYG_*` 或指向不可达端点 | fake 模式继续；真实模式记为失败运行且不自动续跑 | 失败可见、不伪造成功 |
| OCR 未配置 | 上传扫描件 PDF | 明确"无法识别"而非猜测内容 | 不编造文本 |
| 并发重跑 | 对运行中案件再提交 rerun | `409 case_active`；不产生第二个运行 | 并发保护 |

> **存储模式口径**：demo/production 默认严格（S3 写失败即失败，不静默降级）；本地回退仅在显式配置 `s3-fallback-local` 的开发形态启用（见工程规格 §5.3）。受管演示 CLI 已入树：minimal（根 `.env`）`bun --env-file=.env scripts/demo/cli.ts up|down|reset|seed|verify|check`；demo profile（受管 `.demo.env`，`up` 生成）另含 `ready`；备份/恢复 `scripts/demo/backup-restore.ts backup|restore`（需 `.demo.env`）。统一回归（S3）后本文复现步骤以 CLI 为入口；compose 兜底路径保留。

## 6. 一键复现（完整）

```bash
# 受管演示栈（首选；.demo.env 由 up 生成，0600）
bun --env-file=.demo.env scripts/demo/cli.ts up
bun --env-file=.demo.env scripts/demo/cli.ts verify
# 打开 http://localhost:3000

# compose 兜底（完整栈容器化）
docker compose up --build        # 演示栈
# 打开 http://localhost:8080
docker compose exec api bun run seed:demo
```

第三方视角的完整步骤（含 verify 与验收）见 `docs/competition/PROJECT-BRIEF.md` §7。

## 7. 脚本纪律

1. 所有 POST 使用合成文本；不得粘贴真实合同。
2. `seed:demo` 与任何 reset 只在 demo/test 库执行；未知/生产库必须被拒绝。
3. 当前无认证，不需要 token/cookie；若重新引入认证，凭据只从环境变量读，不写进脚本文件、不打印，也不进 URL/查询参数。
4. 每支脚本的预期输出来自代码契约；契约变更时同步更新本文。
