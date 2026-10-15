# S0 基线审计

记录日期：2026-10-15。执行依据为用户提供的五 Agent 工作书，阶段顺序 S0→S1→S2→S3→S4；每阶段完成验证后单独提交。

## 版本与范围

- 基线：`d9a84a4055b629d9b1af12e545dbcd574fcf416b`，提交 `chore: checkpoint OCR, agent tracing, and research updates`，共88个文件，+9291/-476。提交后工作区干净，未推送。
- 主提示词 SHA-256：`9c62c85e9268cc237f698e7fa8de00c830dc432d6873ee46269246edabd16816`。
- 五 Agent ZIP SHA-256：`2fb2911093361d35a3bad472faa6639b4a20ab1dc34b667ddd41e438c015489a`。
- Git 历史已实际读取：`git log --all --date=short --since=2026-09-11 --format='%h %ad %s'`。历史起点 `2cee58a`；`1c1dc7b` 于09-17切换RustFS，`c260e4b` 于10-14变更重审行为。本轮日期不能据此改写历史完成时间。
- 工作站实测：Bun `1.4.3`、Node `v24.19.0`、Docker Engine `29.8.2`、Compose `v5.5.1`。CI/Docker仍固定Bun `1.4.0`，这是环境差异。

## 隔离与数据保护

使用独立、detached worktree `/tmp/contract-audit-omp-s0-d9a84a4` 验证基线。原仓库 `.env` 不变，未删除用户数据或卷。

创建并迁移两个全新数据库：

- `contract_audit_omp_s0_unit_20261015`：单元/数据库集成测试。
- `contract_audit_omp_s0_20261015`：浏览器验收与基线运行检查。

验收worktree的根 `.env` 与 `PLAYWRIGHT_DATABASE_URL` 对齐，规避现有三个清理脚本直接读取 `.env` 的缺陷。此隔离是本轮验证措施，不等于该缺陷已修复。

基线提交前扫描新增/变更内容9292行，未命中常见provider/GitHub/AWS密钥、私钥或带口令连接串模式；候选文件无二进制、超5MiB文件或运行日志/数据库/私钥文件。这是模式检查，不能替代完整安全审计。

## 实际命令与结果

| 检查 | 实际结果 | 证据与限制 |
| --- | --- | --- |
| `bun install --frozen-lockfile`（主仓库） | PASS；依赖无变化 | 425 installs /551 packages |
| 同命令（基线worktree） | PASS | 417 packages installed |
| `docker compose config --quiet` | PASS | 未打印展开后的环境秘密 |
| `docker compose up -d --wait postgres redis rustfs` | PASS；三个服务healthy | 原服务先前均Exited；原持久化卷保留 |
| `bun run check:migrations`（apps/api） | PASS | Drizzle journal检查通过 |
| `bun run migrate`（两个新库） | PASS | public实测18张业务表 |
| `bun run verify`（数据库不可达时） | 626 PASS /26 SKIP /0 FAIL | 不是完整数据库验证 |
| `DATABASE_URL=<独立单测库> bun run verify` | **652 PASS /0 SKIP /0 FAIL** | lint、两轮TS检查均通过；74个文件，1938次expect，测试13.14秒、总命令28.37秒 |
| `bun --filter @contract-audit/web build` | PASS | 3367 modules；JS1599.60kB/gzip502.59kB；构建11.05秒，存在包体积警告 |
| 首次 `CI=true ... bun run acceptance` | 环境失败 | 缺少`chromium_headless_shell-1243`；不能作为产品失败数 |
| `bunx playwright install chromium` | PASS | 下载匹配Chromium153 /revision1243与FFmpeg；WSL使用Ubuntu24.04 fallback build |
| 安装后完整 `CI=true ... bun run acceptance` | **37 PASS /1 FAIL** | 38例、单worker、172.94秒；失败为旧Agent重运行用例，见下文 |
| `GET /api/health`（3302） | PASS | status=ok，database=true，dispatcher=true，agentMode=fake |
| Web HTTP与实际浏览器（5302） | PASS | 1440×900审计队列实际可见；空状态与新建入口存在 |

同一待复核合成案件的实际响应式对照：1440px下风险与复核面板均为`display:flex`，可见复核操作2个；375px下两个面板均为`display:none`，可见复核操作0个。截图：[桌面](./evidence/s0-review-1440.png)、[窄屏](./evidence/s0-review-375.png)。这是实测可用性缺陷，不能因桌面E2E通过而忽略。

失败用例：`tests/acceptance/audit-case.spec.ts:191`。等待旧“重新运行 Agent”按钮超时；同一用例还期望对已复核案件调用`/retry`追加原案运行。当前领域约定是重新审计新建Audit Case，原案复核/整改不变。S2应改成验证真实业务不变量的验收，不能只重新固定按钮文字。

本轮未以真实合同调用外部模型。fake/fixture用于验收；健康信息中的已配置模型不代表模型推理已验证。尚未运行Laya或Jev。

## 服务与诊断

主Agent曾启动的受管理服务：

| 标识 | PID | 端口 | 命令 |
| --- | --- | --- | --- |
| `contract-audit-s0-api` | 39612 | 3302 | 指定独立DB、fake模式运行`bun --env-file=.env apps/api/src/app.ts` |
| `contract-audit-s0-web` | 39619 | 5302 | `API_PROXY_TARGET=http://localhost:3302 bun --filter @contract-audit/web dev --host 127.0.0.1 --port 5302` |

OMP可按服务标识查看日志与停止；Playwright的3301/5301服务由测试运行器管理。后续阶段使用最新代码时必须重新启动对应进程；交付前清理本轮自建进程，不停止用户原有服务。

## 已确认缺口

- 基线E2E尚未全绿；详见上述重审契约问题。
- 三份验收清理脚本绕过数据库覆盖配置，可能误用开发库。
- RustFS与Redis只有内存假实现单测，尚无真实服务往返与故障集成验证。
- DecisionProvider、持久化影子任务、决策反馈/详情尚无实现；现有研究不能充当接入完成。
- README仍称MinerU是空槽位，架构仍称17条规则，启动手册仍称13张表；均与当前实现不符。
- 无覆盖率工件、统一RTM或竞赛交付索引；Bun分支覆盖率能力需单独核实，不能用行覆盖率代替。
- 演示reset缺环境/确认保护，HTTP入口可默认重置；关联核验Source Record无demo归属，清理亦非事务。需保留非demo数据并验证无孤儿累积。

## 五个只读 Agent 已交回

| Agent | 审计范围 | 已确认结果 |
| --- | --- | --- |
| QaBaseline | Q1–Q6、测试/CI/数据库清理 | 已有真实规则/Guard/复核回归；缺RTM、覆盖率工件、真实S3/Redis/SSE验证，清理配置不一致 |
| InfraBaseline | I1–I7、Compose/S3/demo | 复用既有Adapter与seed；发现路径/桶归属、reset授权/事务/核验Source Record清理缺口 |
| DecisionBaseline | A0–A8、调度/快照/接口 | 新决策层尚未实现；需要独立持久化任务、冻结准确快照/运行及有效输入，禁止倒配最新快照 |
| UxBaseline | F1–F6、路由/组件/行为 | 核心桌面操作已存在；无影子详情；窄屏隐藏复核的问题已由Main实际复现 |
| DocsBaseline | R1–R8、架构/研究/历史 | 既有方案/ADR/调研可复用；需校正文档漂移并补工程与竞赛证据 |

以上审计均只读；实际命令、浏览器、数据库、迁移由Main统一执行。原始会话输出不作为“已实施”证明，后续每项以代码和实跑验收更新状态。

五份审计的详细任务与状态见[TASK-MATRIX](./TASK-MATRIX.md)，部署与治理限制见[RISKS](./RISKS.md)。
