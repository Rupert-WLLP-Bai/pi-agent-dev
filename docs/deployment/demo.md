# 演示环境部署与运行

本页描述本地演示栈的两种配置档（profile）、启动命令、安全默认值、限制与恢复方式。
命令与文件都对应仓库中的真实脚本；未实际运行过的项目在本页末尾单独标注，不混入已完成结论。

## 1. 两种配置档

| 档位 | 用途 | 需要的凭据 | 对象存储 | 决策影子 |
| --- | --- | --- | --- | --- |
| minimal | 本地开发、离线演示 | 无 | 本地目录 `UPLOAD_DIR` | `off` |
| full | 完整演示、集成验收 | 访问口令 + 加密密钥（各 ≥32 字符） | RustFS（严格模式） | 显式开启 |

选择方式由环境变量决定，不需要改文件：

```bash
# minimal：无模型凭据，fake 审计代理，原件落本地磁盘
APP_ENV=development AUDIT_AGENT_MODE=fake S3_ENDPOINT= bun --env-file=.env scripts/demo/cli.ts up

# full：容器内跑完整栈，对象存储与访问门禁都生效
APP_ENV=demo bun --env-file=.demo.env scripts/demo/cli.ts up
```

`minimal` 不需要任何密钥即可跑通上传、审计、复核、整改全流程：`AUDIT_AGENT_MODE=fake` 使用确定性的
演示代理，`S3_ENDPOINT` 留空时原件写入 `UPLOAD_DIR`。

## 2. 必备环境变量

`demo`/`production` 启动前必须提供下列值；`development`/`test` 可省略。省略时相关能力退化为本地模式，
不会伪造成功。

| 变量 | 要求 | 说明 |
| --- | --- | --- |
| `APP_ENV` | `demo` 或 `production` 时强制校验 | 同时决定演示重置是否被允许（仅 `demo`/`test`）与对象存储默认是否严格 |
| `API_ACCESS_TOKEN` | ≥32 字符 | 除 `/api/health` 与 `/api/session` 外的所有 API 路径都要求 Bearer 或 HttpOnly 会话 |
| `LLM_KEY_ENCRYPTION_SECRET` | ≥32 字符 | 封存模型服务与 OCR 凭据的密钥；轮换见 `docs/runbook/key-rotation.md` |
| `DEMO_ENVIRONMENT_ID` | 已注册 | 演示环境标识 |
| `DEMO_DATABASE_NAME` | 与 `current_database()` 一致 | 目标库身份 |
| `DEMO_RESET_CONFIRMATION` | 与 `DEMO_DATABASE_NAME` 完全相同 | 重置的显式确认 |

密钥不写入仓库：`scripts/demo/cli.ts up` 生成受保护的本地环境文件 `.demo.env`（已加入 `.gitignore`
与 `.dockerignore`），只报告是否已生成，不回显内容。`LLM_KEY_ENCRYPTION_SECRET_NEXT` 仅用于轮换维护，
不进入常规 compose 转发。

## 3. 一键就绪

```bash
bun --env-file=.demo.env scripts/demo/cli.ts up      # 受管环境、基础设施、迁移、登记、首次播种、api/web、健康检查
bun --env-file=.demo.env scripts/demo/cli.ts check  # 只诊断：环境、登记、对象存储、演示世界
bun --env-file=.demo.env scripts/demo/cli.ts verify # 对运行中的 API 做启动验收
bun --env-file=.demo.env scripts/demo/cli.ts seed   # 重置后重新播种
bun --env-file=.demo.env scripts/demo/cli.ts down   # 停止本地栈（保留数据卷）
bun --env-file=.demo.env scripts/demo/cli.ts status # compose ps
bun --env-file=.demo.env scripts/demo/cli.ts logs   # compose 日志（可跟服务名）
bun --env-file=.demo.env scripts/demo/cli.ts ready  # 就绪演练：两次 reset 对比 + 非演示哨兵保护 + API/孤儿检查
```

`up` 按顺序执行：`docker compose up -d --wait` 启动 postgres/rustfs/redis → `compose run --rm
rustfs-init` 幂等建桶（一次性任务不用 `--wait` 等待）→ 以受管 `DATABASE_URL` 迁移 →
向服务器确认 `current_database()` 后登记演示身份 → 仅当演示世界为空时重建播种（重复 `up`
不清空现有演示数据；要重建请显式 `reset`）→ `docker compose up -d --build --wait api web` →
对 `${API_BASE_URL}/api/health` 与 Web 端口做真实应答检查。每一步失败即中止并打印原因
（凭据经 `redactDemoOutput` 脱敏），不继续到下一步，也不在没有真实应答时声称成功。

**服务端口只绑定 127.0.0.1**。需要局域网访问时显式覆盖，例如 `API_BIND=0.0.0.0`；默认值刻意不做成
可被网络访问的状态。

## 4. 演示重置的安全边界

`reset` 与 `DELETE /api/demo/world` 共用同一套检查，缺一不可：

1. `APP_ENV` 必须是 `demo` 或 `test`；未设置或生产环境一律拒绝。
2. `DEMO_RESET_CONFIRMATION` 必须与 `DEMO_DATABASE_NAME` 逐字相同。`CI=true` 不是授权。
3. 连接的库必须等于 `DEMO_DATABASE_NAME`，且 `demo_environments` 中必须有对应登记行。
4. 存在仍在排队或运行的演示案件时拒绝（`demo_run_active`）。

通过后，删除在**单事务内持互斥锁**（`pg_advisory_xact_lock`）执行，只删除 `source_records.metadata`
中 `demoSeed=true` 的行及其关系链；非演示案件、规则、规则版本、配置与迁移记录一律保留。
重置结束后运行孤儿校验（`countDemoResetOrphans`），影子任务与反馈必须为 0。

对象存储中的原件不在此范围内：现有播种不写原件，因此重置不遍历、不清空任何桶或目录。

## 5. 备份与恢复到新库

备份与恢复工具只连接受管环境（`.demo.env`），不读取也不需要根 `.env`：

```bash
# 备份受管演示库到 .demo/backups/<库名>-<时间戳>.dump
bun --env-file=.demo.env scripts/demo/backup-restore.ts backup

# 恢复到全新的数据库：RESTORE_DATABASE_NAME 必须与源库不同且尚不存在
RESTORE_DATABASE_NAME=contract_audit_restore \
  bun --env-file=.demo.env scripts/demo/backup-restore.ts restore
```

`DUMP_FILE` 可指定某一份备份；缺省取 `.demo/backups` 中最新的一个。`DEMO_BACKUP_DIR`
可改变备份目录（缺省 `.demo/backups`）。

规则：

- **恢复只写入不存在的数据库**。目标库已存在即拒绝，不会 drop、不会覆盖；目标名还必须是
  合法的 PostgreSQL 标识符。
- **凭据不进入命令行或日志**。`pg_dump`/`createdb`/`pg_restore` 通过 libpq 环境参数
  （`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`）取得连接信息，命令行参数里没有
  连接串；子进程输出先经 `redactDemoOutput` 脱敏再显示。
- **备份与恢复同样受演示环境守卫约束**：`APP_ENV` + 确认值之外，还会向运行中的服务器查询
  `current_database()` 与 `demo_environments` 登记行（与重置共用的身份检查）。未注册或
  登记不符的数据库一律拒绝，生产库不会因此获得演示身份。
- 备份为 pg_dump custom 格式（`--no-owner --no-privileges`），文件名带时间戳，重复备份不会
  互相覆盖，演练可以追溯到确切的那份转储。
- **范围仅限数据库字节，不是完整灾备**。对象存储中的原件不复制也不删除：原件按 locator 共享
  同一个桶，恢复出的副本行仍指向同一对象。若对象存储本身丢失，数据库备份无法重建原件；
  需要完整恢复时必须另行备份对象存储数据卷。

用完的一次性副本由操作者手动删除；本工具不提供自动清理。

## 6. 故障与降级

| 情况 | 表现 |
| --- | --- |
| PostgreSQL 不可达 | `/api/health` 返回 503；API 不服务审计 |
| 对象存储不可达（严格模式） | 上传返回 500，**不会**改写本地目录；健康行显示“严格模式” |
| 对象存储不可达（`S3_STRICT=false`，仅限开发） | 上传退回本地目录；健康行显示“本地回退”；Source Record 记录真实后端 |
| Redis 不可达 | 主体核验缓存关闭，直接调用提供方；不影响审计结论 |
| 决策影子不可用 | 正式审计、规则、发现、复核、整改完全不受影响 |

## 7. 限制与尚未实测的部分

以下为**未在本工作树实际运行**的项目，需由 Main 在集成环境执行并记录证据：

- 真实 RustFS 的上传/下载/哈希/重启持久化/凭据错误/对象缺失/重复上传矩阵。
- 连续两次 `reset` 的非演示哨兵与计数保持、孤儿计数为 0。
- `docker compose --build` 在 `APP_ENV=demo` 下的实际启动（含 ≥32 字符口令校验）。
- `minimal` 与 `full` 两档的真实启动耗时。
- `backup` / `restore` 的一次完整往返（含目标已存在时的拒绝路径）。
- `ready` 的完整就绪演练（两次 reset 对比、非演示哨兵保护、API 应答与孤儿检查）。

本页只描述脚本与配置的真实行为，不声称上述场景已经跑过。
