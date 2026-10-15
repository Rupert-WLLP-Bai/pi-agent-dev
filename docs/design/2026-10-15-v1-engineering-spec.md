# Contract Audit V1 统一实施规格

- 文档编号：CA-V1-SPEC-001；规格版本：1.0；工程基准日：2026-10-15。
- 状态：设计规格，尚未实施或运行验收。项目计划区间为 2026-09-11 至 2026-11-10；实际研发日期须由 Git 和其他证据重建。
- 本轮范围：合并重复要求、核实静态仓库依据、定义解耦设计和后续任务。只新增文档；不提交现有改动，不修改业务代码，不启动服务，不迁移或清理数据，不执行测试。
- 配套文件：[实施 Backlog](./2026-10-15-v1-implementation-backlog.md)。本规格规定行为与验收，Backlog 规定依赖、责任和执行顺序。

## 1. 合并规则与交付目标

原始要求合并为一条交付主线：保护现有成果 → 建立可追溯基线 → 隔离基础设施 → 统一存储 → 标准数据 → 自动验收与真实质量报告 → 核心交互与 Agent 展示 → 比赛与复制部署交付。

本轮最新指令“先写 spec，不用先动代码”优先于附件中的“立即启动、提交和开发”。附件要求保留在后续 Backlog，不在本轮执行。

统一术语：

| 术语 | 本规格含义 |
| --- | --- |
| 必须 | 对应范围的验收要求，缺失时该门禁不通过 |
| 已有静态依据 | 源码或配置可见，尚不等于当前环境运行通过 |
| 本次规划 | 后续需要实际实现和验证的目标 |
| 阻塞 | 缺少凭证、依赖、权限或能力，不能计为通过或普通跳过 |
| V1 目标 | 计划门槛，不能写成当前实测值 |
| 回放 | 已校验的历史结构化记录，必须标明来源；Fake 不等于回放 |

最终交付必须可以运行、演示、追溯和复制。不得将“脚本已写”“进程存在”“HTTP 200”“Mock 通过”分别当成环境就绪、业务完成或真实模型验收。

## 2. 已核实的静态基线

以下依据来自本轮工作区读取，包含用户尚未提交的改动；不代表只在 HEAD 上存在，也不代表本轮已测试。

| 范围 | 静态依据 | 对后续设计的约束 |
| --- | --- | --- |
| Git | 当前 HEAD 为 `c260e4b`；工作区存在大量已修改及未跟踪文件 | 保留现有成果；实施前先审查差异和敏感信息，再形成安全基线提交 |
| 前端 | `apps/web/package.json`：React 19、Vite、Ant Design 6、TanStack Query/Router | 复用现有体系，不重写前端技术栈 |
| API 与数据 | `apps/api/package.json`、`src/app.ts`、`src/db/schema.ts`：Bun、Elysia、Drizzle、PostgreSQL | 保持模块化单体、工厂注入和已提交迁移机制 |
| 领域与 Agent | `packages/audit/src/ports.ts` 已定义 `AuditAgentPort`；API 装配 Pi/Fake Adapter | 不用存储、质量平台或模型 SDK 污染领域 Interface |
| 对象存储 | `apps/api/src/document/original-store.ts` 已使用 AWS S3 SDK，提供 `OriginalStore.save/read` | 承接现有实现，不另建一套平行业务存储 |
| 存储差距 | 现有 S3 写失败会回退本地；现有 Interface 未提供删除、列表和统一错误分类 | 显式区分严格 S3、本地、允许降级三种模式 |
| 基础设施 | 根 `compose.yaml` 已配置 PostgreSQL 18、Redis、RustFS `1.0.0`、Bucket 初始化和应用 | 目标迁移到 `infra/docker-compose.yml`，不重复维护两份同义部署定义 |
| 配置差距 | Compose 中存在固定开发凭据；初始化工具使用 `latest`；未见 `infra/` 或 Makefile | 配置环境化；版本与镜像健康路径须实测；现有 tag 不等于已验证稳定基线 |
| 演示种子 | `package.json` 已有 `seed:demo`；`apps/api/src/demo/seed-cli.ts` 调用 `seedDemoWorld(reset:true)` | 必须审查并迁移已有种子和归属标记，不能把现有入口视为安全验收流程 |
| 自动检查 | 根脚本已有 lint、typecheck、Bun tests、verify、Playwright acceptance；Web 有 build | 沿用现有工具；API 直接执行 TS，不虚构 API/root build |
| 测试隔离差距 | `playwright.config.ts` 默认允许复用已有服务，默认端口及数据库可与开发环境重合 | 自动验收必须自有环境、明确配置、验证服务身份 |
| CI | `.github/workflows/ci.yml` 已有 quality 和 acceptance，配置 PostgreSQL | 在既有 GitHub Actions 上增量扩充，不另起 CI 平台 |
| 核心交互 | `audit-case-workbench.tsx` 已有三栏证据工作台；reviews/remediations/agent-trace 路由和对应验收源码已存在 | 先实地验证、复用并补缺口，不将重建既有页面当成新增价值 |
| 身份限制 | `apps/web/src/operator.ts` 与 `api.ts` 使用本地操作人偏好和 `X-Operator`；当前装配没有可信登录会话 | 操作留痕不等于认证/RBAC，权限验收与生产适用性须单独判断 |
| 数据清理旁路 | `rules.spec.ts`、`review-center.spec.ts`、`remediations.spec.ts` 自行读取根 `.env`；API 的数据库覆盖不能自动约束这些清理连接 | 必须统一API、runner和cleanup的配置，先修正再运行隔离验收 |
| 演示清理范围 | 现有种子以 `demoSeed` 标记筛选数据，但CLI固定reset；清理Implementation是多条独立删除 | 复用已有归属，不把标签当环境授权；补事务与中断恢复 |
| 覆盖率与报告 | 当前脚本未配置数字覆盖率门禁；数据库测试在不可达时可skip；Playwright配置为line/HTML | 关键依赖不可达必须阻断；新增真实计量和机器可读报告，不能沿用“绿色即完整验收” |

README 中的功能描述只能作为待核实资料。例如 OCR 当前工作区已有新实现，而 README 部分表述仍有历史口径；实施审计要以当前调用路径和运行证据校正。完整 Git 考古、实时健康、测试通过数、覆盖率、对象读写、浏览器体验、模型效果及 ISO 标准版本均未在本轮验证。

本轮通过真实Git命令抽样核实以下提交；`git rev-parse --is-shallow-repository`返回`false`。下表四个提交的作者时间与提交时间相同，但提交日期只证明Git元数据，不能反推每项需求的实际起止或完成率。

| 提交 | Git记录时间（+08:00） | 主题 |
| --- | --- | --- |
| `2cee58a` | 2026-09-11 14:50:50 | 当前可达历史的根提交，Contract Audit MVP |
| `1c1dc7b` | 2026-09-17 11:10:30 | 将MinIO替换为RustFS |
| `5523e9d` | 2026-10-14 15:50:54 | 合同审计skills与知识参考资料 |
| `c260e4b` | 2026-10-14 16:37:42 | 重新运行Agent并保留复核和整改 |

## 3. 范围、优先级与不变量

优先级：P0 为服务不可用、数据损坏、安全缺陷或主流程中断；P1 为比赛闭环、可重复初始化、关键体验与交付证据；P2 为维护、性能和推广能力；P3 为非关键视觉与扩展。严重性与任务优先级分别记录，不用 P2 包装真实安全阻断。

必须保持以下不变量：

1. `Audit Case ≠ Agent Run`，`Fact ≠ Finding Proposal`，`Contract Stance ≠ Negotiation Stance`；术语遵循 `CONTEXT.md`。
2. 规则评估具有确定性权威；Agent 只能经现有工具与 Proposal Guard 提议，不能改写规则结论。
3. Evidence 必须引用真实 Source Record 和有界位置；`DOCUMENT_SPAN` offset 按 Unicode 码点计算，不能混用 UTF-16、字节或 OCR 坐标。
4. Audit Snapshot 不可变；Finding Revision 追加；人工接受和整改建立保持事务性。
5. 重试、规则重评与重新审计语义分别保留；不得覆盖已复核历史。
6. 取消、超时、Session 释放、串行 Trace 写入完成与中断恢复必须可验证；不能靠隐藏异常改善演示。
7. PostgreSQL 负责队列；Redis 仅为外部核验缓存。Dispatcher、Pi Session、SSE 当前仍是进程内能力，不宣称多副本就绪。
8. 用户、生产及非 fixture 数据不得被测试或演示重置删除；对象存储迁移不得改写证据语义或直接删除原件。
9. 不引入新技术栈、通用规则 DSL、独立队列、重复 Trace 平台或无实际需求的抽象。
10. 真实推理、Fake、结构化回放的来源必须可辨识；业务统计必须来自 API，工程指标必须来自真实报告。

SSO、完整 RBAC、多租户、分布式 Dispatcher 和完整 CLM 仍需按实现核实；不得在材料中写成已有能力。现有操作者字段不等于身份认证。

## 4. Module、Interface 与依赖方向

设计目标是小 Interface 承载完整行为，把配置、失败和可测试性集中在真正变化的 seam。优先复用现有 Module；不按下表机械新增 package。

| Module | 所属与 Interface | Implementation 职责 | 禁止承担 |
| --- | --- | --- | --- |
| Audit Core | `packages/audit` 的模型、端口、规则、Guard | 确定性业务判断、证据与历史不变量 | S3/RustFS、Docker、Python、报告 UI、供应商 SDK |
| Agent Runtime | `packages/pi-agent` 实现 `AuditAgentPort` | Pi Session、受限工具、取消、真实 Trace | 修改规则结论、直接清理数据库或对象 |
| Application | `apps/api` 的 route/use case/composition | 授权、业务事务、队列、依赖注入、HTTP 错误映射 | 直接实例化多个散落的 S3 客户端 |
| Storage | 优先落在 `apps/api/src/storage/`，统一 `StorageService` Interface | S3/Local Adapter、引用解析、错误、完整性元数据 | 合同风险规则、Bucket 级全量清空、浏览器权限判断 |
| Environment Orchestrator | `scripts/` 下 Python CLI；Makefile 只作薄入口 | 环境解析、进程管理、步骤编排、报告路径、退出码 | 复制领域判断、Python 直接构造业务表数据 |
| Fixture/Dataset | 复用现有 Bun seed/use case + 版本化 manifest | 数据归属、关联关系、预期结果、幂等灌入与校验 | Docker 生命周期、生产默认清理、伪造 Trace |
| Quality Evidence | 独立报告 schema 与聚合 CLI | 归一化测试结果、覆盖率口径、RTM、门禁 | 根据 UI 需求编造统计、修改测试结论 |
| Product Presentation | `apps/web`，typed API + Query/SSE | 工作台、审计证据、复核整改、演示与质量报告展示 | 读取数据库/S3、执行 reset、计算规则结论 |

依赖方向：Web → Application → Domain ports；Pi Adapter → Domain ports；Application → Storage Interface → SDK/文件系统。Python 编排通过命令调用 Bun fixture、迁移和测试；质量聚合只消费产物，业务执行不依赖质量平台可用性。

RustFS 仅出现在开发基础设施与兼容性验收中。替换为其他 S3 服务应只改变配置与兼容性验收结果，不修改审计领域、Agent、前端或 fixture 业务语义。

## 5. 统一 StorageService 契约

### 5.1 Interface 与权限

承接现有 AWS SDK 和本地 Implementation，逐一迁移调用方后移除重复的 `OriginalStore`/client 包装；不长期保留新旧两套对外 Interface。历史 locator 兼容属于数据兼容，不能成为保留旧代码入口的理由。

运行实例绑定一个经过校验的 Bucket 与允许的 Key 空间；调用方不能自由选择 Bucket、Endpoint 或本地根目录。业务下载仍按 Source Record ID 查库、授权、解析内部引用；不得把任意 `s3://` 或路径作为公共读取参数。

| 操作 | 契约 |
| --- | --- |
| `put` | 接收受控 Key、内容与格式元数据；返回规范化引用、大小、内容类型、原始字节 SHA-256；成功代表实际写入已确认 |
| `get` | 返回内容及元数据；不存在、拒绝和不可用分别分类；支持取消和期限；不得读错后端 |
| `stat` | 读取对象存在性、大小等元数据；健康和交叉校验复用，不把 List 权限视为 Get 权限 |
| `delete` | 仅删除归属已确认的对象；目标不存在可幂等成功；无权或服务故障必须报错 |
| `list` | 强制受控前缀、页大小与不透明游标；不能默默截断；仅供获授权的管理/验收用途 |

运行时 Interface 不包含 `createBucket`、`deleteBucket` 或 `clearBucket`。开发 Bucket 初始化是独立管理命令，使用单独最小权限；业务应用凭据不要求管理 Bucket。列表和删除能力不等于向普通用户开放任意对象管理 HTTP 接口。

统一错误至少区分 `NOT_FOUND`、`FORBIDDEN`、`INVALID_REFERENCE`、`UNAVAILABLE`、`TIMEOUT`、`CONFLICT`、`INTEGRITY_MISMATCH`、`CANCELLED`。SDK 细节在 Adapter 内转换；HTTP 层映射到稳定状态和安全错误信息，不向用户暴露凭据、内部路径或原始 SDK 响应。

### 5.2 内容、引用与一致性

- Key 由应用根据归属、稳定 ID 与安全扩展名生成，例如 `fixtures/<version>/<scenario>/<source-id>.pdf`。不直接拼接用户路径；本地解析需校验真正的目录包含关系与 symlink 策略。
- 持久化 Source Record 的存储引用、原始字节 SHA-256、大小、格式和实际后端；原始文件 hash 与 Document IR 文本 hash 分别命名，不能混用。
- 不用 ETag 代替通用 SHA-256。回读、迁移和数据验收按原始字节校验；常规读取避免无必要重复计算。
- 文件写成功后再确认可用业务引用；数据库事务失败则尝试删除本次新建的未引用对象并记录未完成清理。数据库不可见的对象不能被宣称已上传成功。
- S3 与 PostgreSQL 没有跨系统事务；fixture 使用持久化归属清单和步骤日志恢复中间失败。不得在网络不明状态下删除可能被业务引用的对象。
- 同一稳定 Key 重复写仅接受相同内容；内容变化生成新版本或明确冲突，不覆盖不可变审计原件。
- 删除原件必须检查合同版本、审计快照和其他使用者引用。重置只处理已确认由工具独占管理的数据；共享引用或不明归属直接阻断。

### 5.3 模式与环境变量

| 模式 | 行为 | 适用范围 |
| --- | --- | --- |
| `local` | 仅写显式本地根目录 | 选择不用 S3 的本地开发 |
| `s3` | S3 写失败即失败；不改变后端 | 默认开发基础设施、全部 test/demo、生产对象存储 |
| `s3-fallback-local` | 仅在明确配置时允许新写入降级；记录并展示实际后端和降级原因 | 显式兼容的本地开发；禁止 test/demo 冒充 S3 通过 |

沿用 `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、`UPLOAD_DIR`；拟增加 `STORAGE_MODE`、路径寻址和超时配置。精确配置 schema 由实现任务统一定义，不制造同义变量。S3-compatible Adapter 允许配置 path-style，不硬绑定 RustFS 行为。生产可使用标准 SDK 凭据链时，其优先级必须写明。

配置按进程启动解析并注入，不在每个调用里临时读取不同的 `process.env`。修改环境配置后由编排器检测指纹并重建受管进程；不要求危险的任意热切换存储。已有 provider/OCR 动态配置继续沿用当前持久化语义，每次运行或 parse 捕获一致配置。

### 5.4 基础设施与迁移

- `infra/docker-compose.yml` 为基础依赖定义的唯一维护源；单节点 RustFS、持久化卷、必要权限、环境凭据、健康检查和幂等 Bucket 初始化必须齐全。迁移根 Compose 的应用部署职责时保留明确的组合方式，移除重复配置。
- 不凭 README 假设 RustFS `/health` 在选定版本可用；官方说明、实际容器镜像、重启持久化和 S3 操作共同验证。镜像在稳定演示前锁定已测具体 tag 或 digest；辅助 CLI 镜像也不使用 `latest`。
- 历史 `s3://bucket/key` 与本地 locator 必须继续可读，但必须经过资源白名单。不能因改名 Bucket 就失去原件访问能力。
- 迁移命令默认 dry-run，逐项复制、回读验 hash、生成迁移清单，支持断点重试。通过可审计的存储位置映射切换解析目标，不修改 Source Record 文本、既有快照、Evidence Locator 或 Finding 历史；具体持久化设计在 ADR 中确定。
- 未完成验证不切换；旧原件默认保留。跨 S3 服务迁移、备份恢复和回退都必须有可执行步骤及验收记录。

## 6. dev/test/demo 隔离与清理保护

| 资源 | dev | test | demo |
| --- | --- | --- | --- |
| PostgreSQL | 独立 dev DB/角色 | 独立 test DB/角色，禁止访问 demo DB | 独立 demo DB/角色 |
| Bucket | `agent-artifacts-dev` | `agent-artifacts-test` | 固定 `agent-artifacts-demo` |
| Key 归属 | 开发业务与 fixture 分清归属 | fixture 版本 + run namespace | fixture 版本 + demo dataset namespace |
| Redis | dev key prefix | test key prefix | demo key prefix |
| API/Web/日志 | 独立端口与服务标识 | 独立验收进程与产物目录 | 独立演示进程与产物目录 |

同机可共享 PostgreSQL/RustFS 服务，但数据库角色、Bucket 策略、命名空间和清理权限必须隔离。Compose volume 只负责持久化；不能通过 `down -v` 或删除共享目录实现环境重置。已有 `contract-originals` 按历史资源处理，不能自动清理。

每次删除同时满足：

1. 环境明确为 `test` 或 `demo`；生产及未知环境一律拒绝。
2. Endpoint、数据库身份、角色、Bucket 和 namespace 与资源白名单一致；配置中的数据库名后缀或一个环境变量不能单独授权。
3. 目标库中有初始化登记的环境标识，与本次资源清单匹配；角色权限在基础设施层阻止跨环境操作。
4. 具备本次动作的显式授权：交互 CLI 确认，或编排器传入精确目标的非交互授权参数。不得仅凭 `CI=true` 允许删除。
5. 删除集合来自 fixture 管理清单，ID 与归属标签交叉核验；先生成预览和审计摘要。
6. Dispatcher 已停止领取该环境受影响任务，相关执行已结束或取消；同一环境加互斥锁，禁止两个 reset 同时运行。
7. 外键、追加历史、对象共享关系已校验；发现非工具数据引用 fixture 数据则阻断，不能级联误删。

`reset_demo` 只能操作 `agent-artifacts-demo` 内被管理的对象及对应 demo 业务关系，不删除 Bucket，不清理其他 Bucket；`seed_demo` 为幂等灌入，不能隐式执行全量删除。对 test 实施相同保护。已有 demo UI/API 入口也要迁移到相同授权和归属契约，不能留下另一条绕过 CLI 的破坏性路径。

## 7. 自动化命令与生命周期

Makefile 只转发到跨平台 Python 编排器；不用 Make/shell 承载业务逻辑。Python 使用结构化参数调用子进程，避免 POSIX `source`、字符串拼 shell 或将密钥输出到日志。无 Make 环境可直接使用同一 Python CLI。

配置文件拟采用独立的dev/test/demo模板与未跟踪的本机私密文件。解析顺序固定为“显式环境与文件选择→命令行非敏感覆盖→所选文件→该环境的安全默认值”；凭据由明确指定的环境变量/私密文件注入。test/demo不能从根`.env`或裸`DATABASE_URL`推断清理目标，Bun/测试子进程不得再次隐式加载配置覆盖已经解析的资源。当前shell存在冲突环境变量时，编排器必须拒绝或显式覆盖并说明非敏感目标，不能静默混合两个环境。

| 入口 | 必须行为 | 禁止行为 |
| --- | --- | --- |
| `make dev` | 校验配置 → 启动依赖并等待健康 → 应用已提交迁移 → 启动/复用配置一致的受管 API/Web → 真实请求和页面 smoke | 重置已有数据、生成迁移、终止无关占端口进程 |
| `make test-all` | 创建/确认隔离 test 资源 → 迁移 → 安全 reset/seed → DB/S3 交叉校验 → 静态检查、Unit、Integration、Agent、E2E、Web build、Smoke → 汇总报告 | 使用 dev/demo 数据库、静默跳过关键依赖、复用身份不明的旧服务 |
| `make demo-ready` | 完整运行所选门禁的 test-all → 仅成功后迁移 demo → 授权 reset_demo → seed_demo → 交叉校验 → 启动 demo → 非破坏性最终 smoke → 输出访问地址和报告 | 测试失败仍重置演示、最终 smoke 改写演示业务记录、笼统宣称 V1 通过 |

另提供 `demo:seed`、`demo:reset`、`demo:verify`；实现脚本命名可采用 `seed_demo`/`reset_demo`，但全部入口调用同一 Module。现有 `seed:demo` 在切换期迁移全部文档与调用后移除，不长期维护两个语义不同的入口。

测试 Profile 明确影响门禁：

- 默认 `v1`：确定性测试、真实基础依赖测试和固定合成数据的真实模型验收均为必需。缺少模型/核验凭证时标记 blocked，返回非零，不自动降级。
- 显式 `offline-demo`：确定性 Agent、真实 PostgreSQL/S3、完整业务 E2E 和已校验回放。可准备离线演示；报告只能声明该 Profile 通过，必须同时显示 V1 真实模型门禁未验证，不能称“全量 V1 验收成功”。
- 真实第三方访问只使用批准出网的合成数据；Fixture 模式与外部核验实时模式分别列证据。不是每次单元测试都调用真实模型。

拟定使用方式为`make test-all PROFILE=v1`、`make demo-ready PROFILE=v1`，离线须显式使用`make demo-ready PROFILE=offline-demo`。这些是待实现的入口契约，本轮尚不可执行；Profile选择必须传入报告和最终摘要，不允许通过省略live用例等价切换Profile。

失败步骤立即使命令返回非零；仍保存失败报告和日志，不执行后续破坏性步骤。区分命令失败、阻塞、测试跳过和中断。报告聚合失败也不能报成功。

服务由编排器记录启动 ID、PID/容器标识、Git SHA、配置指纹和日志目录。端口占用先检查身份；不匹配则报错，不杀现有用户进程。配置变化只重建自己管理的服务，停止/重启/日志命令按环境操作。依赖就绪 → 迁移 → API 就绪，不能先拉起读取未迁移表的 API。PID、URL 或监听端口不能单独证明运行的是最新代码。

## 8. 版本化数据集、幂等与回放

优先用 `tests/fixtures/demo/` 保存合成原文、元数据、预期、主体核验响应、回放记录与 manifest；测试复用同一语义数据集，环境和运行状态由装配参数决定，不复制两套相近合同。

manifest 必须包含 fixture/schema 版本、文件 hash/大小/格式、稳定场景 ID、确定性时钟、规则参数版本、预期 disposition/风险、Evidence 定位断言、允许的状态演进、数据归属、回放来源与脱敏说明。稳定 ID 需与现有 UUID 列类型相容；UI 相对时间可使用固定 clock/相对锚点，不能让过期日期使演示随机失效。

至少覆盖：网络建设工程、通信设备采购、基站/机房租赁、网络维护、政企 ICT、软件/IT 采购；并明确覆盖高预付、背靠背、金额大小写不一致、争议冲突、合规、人工判断边界。允许一份合同覆盖多个标签，但必须逐项列出预期，不能把适用范围不符的规则当作成功覆盖。

从真实规则 catalogue 生成当前规则矩阵，初始目标覆盖现有 19 条规则，区分合规、违反、需人工判断、不适用与证据缺失。规则代码和参数版本固定，模型随机文本不能成为标准答案。

数据必须具备完整关联：Contract、Revision、Source Record、真实原件、Snapshot、Assessment、Agent Run、Finding Revision、Human Review、Remediation，以及需要的历史、分派、失败/取消/重试场景。所有文件真实写 S3，不能仅填 URL；存储失败不能留下“已就绪”的 fixture。

幂等定义：同一 fixture 版本和目标环境重复 seed，受管实体数量、稳定 ID、内容 hash、预期业务结果一致，不增加业务版本链或孤立对象。不同运行 ID/测量时间允许不同。版本变更须有显式迁移或 reset；不覆盖已被非 fixture 用户复核的数据。

reset 采用归属清单、事务性关系清理与可恢复的对象删除日志。对象未删或 DB 事务失败时记录中间状态，重复运行可恢复；禁止用全库 DROP/TRUNCATE 或全 Bucket 清理代替。全新 test DB 的创建权限与重置业务数据权限分开。

两种演示共用业务 UI：真实 Pi/LLM 模式展示实时记录；回放模式导入已有真实结构化执行记录并标记原始 run、schema、snapshot、tool/参数/结果和校验结论。回放不能重演不存在的工具调用；Fake 模式始终显示“确定性模拟”，不能换名冒充回放。

## 9. 产品体验与 Agent 增强

### 9.1 核心业务 UI

先实际审查既有导航，再围绕工作台、合同审计、待办复核、风险整改、合同档案、规则、Agent 执行与系统配置组织入口；不为改名破坏已有深链接。复用已有路由和组件，消除重复入口时同步迁移内部链接和验收。

工作台显示真实待办、高风险、执行中、待复核、临期整改及有数据支持的处理趋势。无足够历史时显示空态和统计口径，不补造趋势。

审计结果优先支持合同结构/原文、风险列表、证据详情和复核操作；具体布局以当前页面和浏览器审查为准。必须支持风险 ↔ 证据双向定位、高风险优先、规则/Agent来源区分、四类 disposition、阶段进度、接受/驳回/备注、整改跟踪，以及可理解的上传/执行/失败/不可用反馈。提供桌面和合理窄屏操作路径、键盘焦点与非纯颜色风险表达。

普通过程视图从真实业务事件/已记录 Trace 投影“读取→提取→规则→核验→分析→校验→复核”；阶段无法确认就显示未知或跳过原因，不伪造完成。技术详情提供真实 tool 输入输出摘要、Evidence、轮次/嵌套调用、耗时、模型身份、实际 usage 和 Guard 拒绝理由；未采集字段显示未采集，不推算为真实 token。

### 9.2 Agent 技术选择

先审计 Session、工具白名单、schema、规则/证据读取、proposal、Guard、失败/超时/取消、trace/usage、长文上下文，再选最多 1–2 项增强。

本规格优先候选为“版本化数据集上的规则/Proposal/Evidence 联合评测”和“现有 Trace 的来源标识及业务过程投影”，均优先复用已有数据与运行端口。最终纳入前需证明确有缺口，不以新增依赖数量作为创新指标。

LangExtract、Docling、OpenTelemetry GenAI、Langfuse、多模型比较、长文裁剪/检索、Prompt Injection 防护、多租户/私有化能力分别形成决策表：真实痛点、可测收益、兼容性、运维/资源（含 GPU）、许可证、数据出网、比赛适配、是否立即实施。其余进入有条件路线图，不把调研列表变成必装依赖。

Prompt Injection 防护验证通过本地合成合同的恶意指令样本，断言工具权限、来源隔离、结构化输出与 Guard 保持有效；不以“提示词里要求忽略”代替控制。既有安全问题如被发现，必须修复，不受“最多两项新技术”限制。

## 10. 分层测试与验证矩阵

继续使用 Bun test、现有真实依赖测试和 Playwright，不为报告引入平行测试框架。每个用例有稳定 ID、需求 ID、前置资源、输入、行为断言、产物及清理归属；禁止只断言未抛错、非空或 Mock 参数转发。

| 层级 | 必测范围 | 关键断言与证据 |
| --- | --- | --- |
| Unit | 规则、Guard、状态转移、数据转换、Evidence码点、工具契约 | 确定性业务结果、适用范围、错误与边界；有效覆盖率原始文件 |
| DB Integration | 迁移、事务、版本链、复核整改、队列 claim/cancel/recovery | 真实 PostgreSQL；回滚、互斥领取、状态与历史不变量 |
| S3 Integration | put/get/stat/delete/list、分页、hash、缺失、拒绝、超时/故障 | 真实 S3/RustFS；权限不足不能用本地 fake 代替 |
| API Integration | 上传/下载、格式与大小、业务创建、原件关联、失败恢复 | 真实 DB/S3；HTTP 与业务状态一致；服务失败不误报成功 |
| Agent deterministic | Session、工具 schema/权限、Guard、取消/超时、trace flush | 固定可校验结果；不冒称真实模型质量 |
| Agent live | 固定合成集、模型/Prompt/参数版本、可追溯工具和证据 | 结构化约束、规则遵从、任务完成与延迟，不用字符串完全一致判定 |
| E2E | 上传→执行→风险/原文→复核→整改→关闭→历史/重新审计 | 真实浏览器、最新自有服务、独立 test DB/Bucket；截图、Trace、状态证据 |
| Smoke | 依赖健康、`/api/health`、真实业务读取、核心页面 | 非破坏性，demo最终检查不创建案件或修改规则 |
| Reliability | 重启原件读取、RustFS不可用、任务中断、配置重载、seed中断重试 | 正确错误及恢复、无跨环境污染、可恢复执行记录 |
| Security | 密钥、下载授权、路径/对象越界、SSRF、上传、工具、重置、日志、依赖 | 授权隔离和拒绝证据；禁止绕过校验让演示通过 |

必须额外验证：历史本地原件→S3迁移、S3原件重新审计、Bucket或对象权限不足、分页对象全集、重置不触及其他 Bucket、两次执行不重复、测试不影响 demo、失败后 demo仍完整、修改配置再次执行、生产/未知清理拒绝、全新环境初始化。

当前静态身份依据是本地操作人偏好与 `X-Operator`，不能据此证明请求者身份或角色。登录/权限用例须以可信身份机制为前提；不能编造账号或用自由填写操作者当 RBAC。受控比赛环境限制与生产 RBAC 缺口要明确，相关生产门禁 blocked；确需实现最小访问控制时先定义职责和验收，不把演示模式放到公开网络冒充安全系统。

## 11. 质量指标、报告与门禁

### 11.1 指标口径

| 指标 | 定义/范围 | V1 目标 |
| --- | --- | --- |
| 核心行覆盖率 | 事先版本化的核心业务源码范围；前端、API、audit、pi-agent分开报告 | 核心 ≥80% |
| 核心分支覆盖率 | 同一范围和可证明支持 branch 的覆盖工具 | 核心 ≥70% |
| 集成交互场景覆盖率 | 已有有效用例覆盖的必需交互场景 / 已登记必需场景 | 关键场景100% |
| 系统场景覆盖率 | 已有关联用例的必需端到端场景 / 登记场景 | P0 100% |
| 系统验收通过率 | 本次通过的必需验收用例 / 本次全部必需用例 | P0/P1 100% |
| 需求追踪覆盖率 | 关联至少一个有效测试的需求 / 纳入统计需求 | P0/P1 100% |
| 需求验收通过率 | 所有必要判据均有本次通过证据的需求 / 纳入验收需求 | P0/P1 100% |
| Agent 专项 | 按 live/fake/replay 分组的任务、工具、schema、Guard、证据和恢复指标 | 先测基线，再定非结构性质量阈值 |

不能平均不同指标生成“整体覆盖率”。跳过/阻塞的必需用例不从通过率分母移除；未执行、未测量为 null/未验证。Guard 拒绝率与业务质量分开，合法拒绝不等于模型失败。规则评测分别给漏报、误报、非预期风险、Evidence定位有效率与样本分母。

现有 Bun coverage 的分支能力须先实测确认。LCOV 不含有效 `BRDA`/分支数据时不能生成虚假分支率；确有缺口才评估最小覆盖采集方案，无法测量则门禁 blocked，不偷偷缩小范围或降低目标。覆盖率只能以有效断言提升；不为凑数写实现镜像测试。

### 11.2 报告契约

每次运行保存独立目录及 `latest`索引，生成 JSON 与 HTML；提供 JUnit XML、原生 LCOV（必要时真实转换 Cobertura）、Playwright HTML/Trace/失败截图和必要日志。大体积运行产物作为 CI/本地 artifacts，不无差别提交 Git；仓库保存规格、schema、可审计摘要和产物索引。

统一 JSON 至少记录：schema/config/fixture版本、run ID、Git SHA与dirty状态、项目版本、配置脱敏指纹、环境/依赖/镜像/工具版本、起止时间、步骤状态、退出码、各层通过/失败/跳过/阻塞数量、核心场景、对象数/hash校验、Agent来源与状态、覆盖率范围及原始文件、RTM判定、缺陷与门禁、证据相对路径。

密钥、DSN口令、合同敏感正文、认证头和含密钥URL不进入报告。配置指纹只使用安全字段和 secret 版本标识，不对低熵密钥做可公开猜测的 hash。截图/Trace也纳入敏感信息审查。缺失、过期、损坏、其他commit或其他配置的证据均不能被当成本次成功。

### 11.3 两类门禁

- 演示准备门禁：对应显式 Profile 的必需检查全通过，完整数据集、真实 S3、端到端闭环、最终非破坏性 smoke，且无未解决 P0/P1 阻断缺陷。
- V1 发布门禁：全部 P0/P1 需求完成并验收，核心行/分支目标、真实模型验收、失败恢复、安全、文档、复制部署和可重复初始化均有当前证据。任一缺失即 fail/blocked；offline-demo成功不能覆盖该结论。

工程质量 Dashboard 优先直接展示生成的 HTML。若增加 Web 管理页面，只读版本化报告投影与证据索引，必须区分 commit、Profile、来源、时间与过期状态；业务首页不依赖报告服务或共享伪造统计。

## 12. 需求追踪与工程治理

建立稳定需求 ID：`FR-*`功能、`NFR-*`非功能、`SEC-*`安全、`AI-*`Agent、`ENG-*`治理、`DEL-*`交付。原始要求重复项合并为一条需求，保留来源段落；含不同验收行为的要求不能只合并成“完善测试”。

每条需求记录业务价值、优先级、来源、验收判据、实现 Module、设计/ADR、用例 ID、运行证据、缺陷和状态。CSV 为机器可读 RTM，Markdown为解释；同一编号不能代表不同语义。已有行为只作为候选实现依据，不能自动倒推出正确需求。

工程实践采用轻量增量交付、风险驱动测试、V模型验证确认与PDCA。引用 ISO/IEC/IEEE 12207:2026、29119、ISO/IEC 25010:2023 前必须联网核实正式名称、版本与适用范围；不得照抄未经核实版本或宣称认证。质量属性映射到真实用例，未测性能不填TPS/百分比。

Git 考古包括 status/diff/cached/log、全分支图、reverse/date、stat/numstat、branch/tag、浅克隆及作者/提交时间。只读恢复初始化、架构、数据、Agent、前端、存储、测试、重构和缺陷里程碑；无法证明的活动标“缺乏证据/推断”。不重写Git以迎合计划。

研发计划同时维护计划与实际视图：开始/结束、责任、依赖、状态、证据和剩余风险。实际视图不以提交数量推算完成百分比；计划日期不是实际交付证明。甘特图保留Mermaid源并在可用工具下导出SVG/PNG；执行时钟与用户工程基准日分别标记。

沿用当前GitHub Actions、Bun锁文件、迁移SQL+metadata和评审流程，补齐分支/commit/review、缺陷严重级别、配置密钥、发布版本、文档和DoD。存储契约、环境隔离/清理、报告口径等重要选择形成简短ADR，不创建复杂流程平台。

## 13. 推广、竞品与比赛材料

推广成熟度矩阵逐项标识：立即可用、配置后可用、需Adapter、需业务改造。覆盖市/区县、网络建设、政企、采购供应链、法务合规、运维；不能把存在页面当成已适配该部门。

技术复制核实 Compose、模型替换/私有推理、独立S3、OCR替换、主体核验Adapter、迁移、部署验收、区域/组织/模板依赖、许可证和资源需求。规则矩阵说明通用/合同类型/地域/内部政策依赖及新增规则所需改动；版本化参数不等于规则逻辑可配置。优先可迁移配置包，不贸然上DSL。

自主代码、运行依赖、研究样本和知识内容分别列权利/许可来源。已有研究记录可复用，但必须核实原始资料与当前授权状态；第三方代码许可证不自动授予其数据包、合同模板或抓取内容的使用权，不能为比赛直接激活或复制未经核实的材料。

生产审查列出内网/离线、脱敏/出网、身份/角色、密钥、备份恢复、审计留痕、故障恢复、多实例、模型成本、CPU/GPU和第三方失效行为。未实现能力明确写入路线图和生产门禁。

竞品调研必须联网，覆盖传统CLM、Icertis/Ironclad/Luminance/Spellbook等商业AI产品，以及确有代码、许可证和近期维护证据的开源项目。逐项比较部署/格式/规则/Agent/证据/复核/审批整改/审计/隐私/扩展/模型替换/适配成本/人群；原始链接、调研日期、可信度与未知项齐备。不以“竞品没有”作无证据结论。

比赛材料用真实源码、演示操作和可测指标支撑五个候选亮点：规则+受约束Agent、多来源证据、人审整改闭环、快照/版本/Trace、配置与私有部署。分别注明既有已验证、既有未充分验证、本轮实施完成、后续规划。

演示提供3/5/8分钟脚本，每步包括页面、按钮、标准合同、预期结果、讲解、技术与业务价值、失败点及备用操作。至少准备一份经规则验证的多风险核心案例和一份合规对照；现场网络失败切换明确标记的回放，不假装实时推理。

## 14. 目标交付物清单

下表为后续产物，除本规格与Backlog外均不声明已经生成。

| 目录/入口 | 内容 |
| --- | --- |
| `docs/improvement/00-baseline.md` | Git、依赖、启动、基线测试、阻塞 |
| `docs/improvement/01-task-audit.md`、`02-ux-audit.md` | 具体问题、源码、影响、证据、方案、工作量、优先级、状态及实地体验 |
| `docs/deployment/rustfs.md`、README | S3定位、基础设施、健康、配置、迁移、复制部署、停启日志 |
| `tests/fixtures/demo/`、`docs/demo/demo-dataset.md` | 版本化原文、预期、覆盖矩阵、回放、seed/reset/verify、统计口径 |
| Makefile、Python CLI、Bun dataset命令 | dev/test-all/demo-ready及安全、幂等、失败退出 |
| `docs/engineering/development-history.md`、`milestones.md`、`architecture-evolution.md` | 真实Git历史、证据限制与架构演进 |
| `docs/engineering/requirements.md`、`traceability.csv`、`acceptance-criteria.md` | 唯一编号需求、RTM、验收判据 |
| `docs/engineering/project-plan.md`、`gantt.mmd`、`risk-register.md`、`release-plan.md` | 计划/实际甘特、责任依赖、里程碑、风险、V1门禁与发布 |
| `docs/engineering/`质量规范与报告索引 | 工程方法、分层测试计划、Unit/Integration/E2E/Agent/覆盖率/验收报告及DoD |
| `docs/competition/scalability-and-reusability.md`、`competitor-analysis.md` | 可推广、复制条件、联网竞品证据 |
| `docs/competition/`申报与演示材料 | 总体介绍、痛点、传统局限、创新、架构、Agent原理、难点、自研/第三方、价值、测试、部署、讲解、FAQ、3/5/8分钟流程 |
| 本地/CI artifacts | JSON/HTML/JUnit/LCOV、Playwright报告、截图/Trace、日志、环境与对象校验清单 |
| Git | 安全基线及按存储、数据、编排、Web、Agent、文档拆分的已验证提交；最终状态说明 |

## 15. 实施约束与本轮验收

实现任务先检查真实调用和既有模式；共享契约由主Agent确定，文件只有一个修改负责人，最多同时推进3–4个大型独立切片。仅主Agent执行共享迁移、数据重置、集成验收与最终提交；子Agent返回文件、问题、验证方式和风险。子任务独立检查不能代替最终完整验收。

未来最终交付汇报按原要求包含11项：总体Phase状态、Git提交、各服务地址与健康、关键代码、技术选择、UX实证、真实测试与覆盖率、演示准备、竞品推广、P0–P3遗留、五个有源码/场景支撑的亮点。质量门禁不通过必须明确原因与可恢复状态。

本轮规格验收只检查：原始要求已归并且可追踪、已有能力与规划分开、Module/Interface/依赖及数据兼容明确、命令/失败/清理/报告门禁可判定、后续TODO完整且有顺序。应用未运行，故本轮不输出测试通过率、覆盖率、部署健康或真实模型能力结论。
