# S1 公共集成契约

冻结日期：2026-10-15。输入代码基线`d9a84a4`，S0审计提交`a4c6119`。本文冻结S2的Interface、职责和安全不变量；**S1只交付契约，不声称影子推理/持久化/界面已经运行**。实际验证见[基线](../project-management/BASELINE.md)。

## 1. 规范与唯一真相

- 新增规范类型：`packages/audit/src/decision.ts`，通过`@contract-audit/audit/decision`导出。沿用现有strict TypeScript、相对包内引用和明确跨包export。
- 领域术语：Shadow Advice为独立辅助建议；Shadow Feedback为建议的评估反馈。两者均不是Finding Proposal、Rule Assessment、Evidence或Human Review。
- 19条规则、Contract Stance、Pi受控工具、Proposal Guard、Finding追加版本、人工复核和整改语义不变。新Provider没有写正式结果或执行工具的Interface。
- 不新增独立大型平台或消息中间件；Adapter置于`apps/api/src/decision/`，复用现有PG、Elysia、typed API及Ant Design。

## 2. 公共模型

以代码中的`DecisionRequest`、`DecisionProviderResult`、`DecisionAdvice`、`DecisionFeedback`、`DecisionAdviceList`与`DecisionDetail`为规范，禁止各端复制另一份DTO。

| 模型 | 关键约束 |
| --- | --- |
| DecisionRequest | `auditCaseId`、`snapshotId`和`agentRunId`三种身份分别冻结；记录原文hash、问题/策略/脱敏版本、问题类型、脱敏片段、结构化信号、证据引用与traceId |
| DecisionQuestion | choice有字符串选项；score有数值选项；noul有明确criteria；问题来自服务端受控目录，不能由合同文本改写 |
| DecisionProvider | `identity` + `decide(request, signal)`；只返回解析后的建议，无领域写权限 |
| DecisionAdvice | `decisionId`由本系统生成；`mode`只能shadow；记录状态、provider/modelVersion、类型化answer、原始分布/分数、confidenceType、校准状态、阈值版本、同命题冲突、出处、hash、时延与时间戳 |
| DecisionFeedback | append-only；accepted/rejected/needs_review，记录actor/reason/time；不改Finding或审计状态 |
| DecisionAdviceList | `{ schemaVersion, mode, provider, items }`；关闭后仍可读历史items |
| DecisionDetail | `{ schemaVersion, advice, feedback }`；不返回完整request或原始provider响应 |

`answer`是choice/score/noul判别联合；noul原始值保留，不被表述成已校准正确率。缺失值用null，不能填造0%、高置信度或伪造成功。外部响应的额外字段不能直接进入公开DTO。

状态：PENDING→RUNNING→SUCCEEDED/FAILED/SKIPPED。有界重试保持同一decisionId；重启后的任务领取以数据库租约为准，不假装原进程持续运行。

未验证校准时`calibrated=false`、calibrationVersion/thresholdPolicyVersion/threshold均为null，`uncertainty=uncalibrated`或unavailable，`needsHumanReview=true`。confidenceType注明Laya熵集中度、answer confidence或none；集中度和noul不作为正确率，不跨模型复用阈值。

## 3. HTTP契约

所有新路由挂在现有`createApp(deps)`，通过依赖注入可测试；前端使用`AuditApp`推导响应类型。

| 方法/路径 | 成功 | 失败/说明 |
| --- | --- | --- |
| GET `/api/audit-cases/:id/decisions` | 200 `DecisionAdviceList` | 未知/无效UUID为404 `DecisionApiError`，error为audit_case_not_found；已存在案件无建议时items为空 |
| GET `/api/decisions/:decisionId` | 200 `DecisionDetail` | 未知/无效UUID为404 `DecisionApiError`，error为decision_not_found |
| POST `/api/decisions/:decisionId/feedback` | 201 `DecisionFeedback` | body为`{schemaVersion:1,decision,reason?}`；非法字段422、未知ID404；Idempotency-Key防止网络重试重复追加，冲突409 |

影子功能关闭时，这些读取仍可呈现已有历史，不能因当前无Provider把过去记录抹去。API不暴露可提交任意模型state、任意endpoint或直接修改正式Finding的路由。辅助反馈入口独立标识“仅用于评估，不改变审计结论”。

`X-Operator`不是认证。Main统一实现服务端访问口令门禁：`API_ACCESS_TOKEN`启用时，除健康与登录外所有API（包括SSE、原件及影子详情）要求Bearer或HttpOnly会话；`GET /api/session`报告是否需要登录，`POST /api/session`接收`{token}`，`DELETE /api/session`登出。demo/production非测试启动要求口令；development/test可显式不配置，仅限可信本机。UX实现“访问口令”入口；QA分别证明匿名拒绝与授权访问。口令不进入URL、日志、公开health或localStorage。该单工作区门禁不等于SSO/RBAC/租户隔离；actor仍须校验空值与最大128字符。

已建立的Cookie会话SSE也受撤销和到期约束：登出/到期主动结束流并取消上游订阅，不能只拦后续HTTP请求。Bearer连接的有效期随进程与访问口令轮换处理。

## 4. 持久化、恢复与正式链路

Main是迁移执行与最终集成Owner；AI是`schema.ts`唯一编辑Owner，统一收集其他Agent的表/字段需求后交给Main生成并执行一个增量迁移批次。

- Audit Snapshot领域对象没有DB行id；不能把Source Record id或Audit Case id当snapshotId。AI应返回真实的persisted snapshot引用并迁移所有受影响内部调用。已有公开案件响应继续返回原来的snapshot结构。
- Agent Run保存确切snapshot关联与冻结的、最小化的影子输入；不靠“当前最新快照”还原过去。有效上下文包含运行当时的主体/历史评估，不能事后取当前结果替代。
- 正式成功终态与对应Run的成功标记应具备可靠关联；独立扫描只派生已证明成功的运行。失败、未完成、被取消、关联无法证明及旧版本未冻结输入的运行不伪造建议。
- 使用独立`shadow_jobs`持久化输入引用、状态/租约/次数与最终Advice，`shadow_feedback`保存独立追加反馈；允许JSONB承载冻结payload，但查询/幂等字段须有索引。
- 幂等身份包括Run、Snapshot、inputHash、question/policy/redaction版本、provider/modelVersion。不能以可空复合unique造成重复；缺失身份应拒绝派生。
- Worker独立扫描与领取，有界并发、超时、重试和租约过期恢复。不使用Audit Case的PENDING队列，不依赖进程内SSE作为任务可靠性来源。
- 正式dispatcher不得await模型HTTP。影子表、队列、provider或反馈故障不能使成功Audit Case转FAILED，不能改写Snapshot/RuleAssessment/Finding/HumanReview/Remediation。
- 新表到case/run的归属边支持受管demo清理；反馈随所属影子记录处理。生产保留期和删除说明写入治理文档，不能通过清空正式审计数据实现。

DTO不返回内部租约、凭据或原始request。公开status/fallbackReason足以解释失败，不能把provider异常中的合同片段、token或连接串原样回显。

## 5. 隐私与模型边界

- `DECISION_MODE=off|shadow`，默认off；`DECISION_PROVIDER=disabled|fake|laya-cpu`，默认disabled。off不创建、不领取、不调用推理；历史读取不受影响。本轮明确取消Jev及其他远程决策Adapter。
- Laya优先受控本地CPU服务。固定代码SHA `432312b36714d8889eba405507b37eda25257d9c`与多语权重revision `1720e3e3357cfe1e281542e223f8273b0890ca34`；启动与模型可推理分别检查。
- Endpoint来自服务端配置，校验origin、协议、凭据/fragment/redirect及私网策略；本地/容器Laya明确列入允许origin，不能通过放开全局LLM策略隐式允许任意地址。
- Laya仅接受服务端配置的loopback或明确允许的容器origin；禁止重定向、userinfo、fragment和不受管地址。SYNTHETIC只由受管fixture/内容指纹证明，不接受调用者自报。原始合同默认不发往外部模型；真实Pi验证使用已配置的`http://127.0.0.1:3425/v1`与`panda-local/cqmoma/cqcm/deepseek-v4-flash`，仅发送合成合同。Main负责Pi出网策略，AI负责Laya最小输入和脱敏。
- 正式Pi的合成豁免同时校验运行上下文来源。`AuditSnapshot.subjectVerificationProvider`由dispatcher从实际port捕获；有主体评估时必须明确为`qcc-fixture`，真实/缺失来源均需内部origin授权。核验失败无外部locator也不例外；模型basis不拼接上游错误。该字段是附加运行元数据，不改写已持久化快照。
- Adapter必须构造最小provider state，不能`JSON.stringify(request)`后整体发出。身份、比较答案、gold标签、原文坐标映射及敏感规则basis不进入模型state。
- 片段脱敏覆盖已提取当事人、代码/账号/电话/邮箱等；此机制不是匿名化保证。原文Unicode码点offset与hash保持不变，脱敏长度改变时不拿新字符串下标当原文坐标。
- 冲突仅针对同一命题的互斥判断。类型不同、范围不同或仅概率不同不是规则冲突；`comparison`只做本地比较，不泄漏参考答案给模型。
- 记录原始分布、问题/策略/脱敏版本、inputHash与来源。provider报错不采用Fake伪装真实推理；Fake只作为明确标识的离线演示Provider。

新增环境变量由AI汇总给Infra写入`.env.example`和显式Compose转发。至少包括mode/provider、endpoint、允许origin、model/version、timeout/轮询/重试上限、`DECISION_RETENTION_DAYS`；实现与文档使用同一名称。没有Jev变量或远程决策调用路径。

## 6. 演示重置的共享契约

- CLI与`POST /api/demo/world`共用环境/确认检查。APP_ENV只能demo/test；验证确切数据库身份/受管登记，明确目标确认，不把CI=true当授权；未知/生产环境拒绝。
- 新`demo_environments`登记表由AI schema Owner统一加入；Infra实现注册、锁、预览、重置和验证。生产库迁移不能自动获得demo身份。
- 复用现有demoSeed、固定RNG及scenario/caseKey。删除关系链必须事务化并持互斥锁；拒绝有活动demo运行时重置；验证并清理demo核验Source Record，保留非demo哨兵与所有配置/规则/迁移记录。
- 现有seed不写原件，因此不能随手遍历或清空S3 bucket/UPLOAD_DIR。未来受管原件仅清理由manifest证明归属的prefix/对象。
- 上传先成功保存原字节，再事务化登记source/original locator/case；失败不能留下可误认成功的PENDING case。Source Record metadata保存hash/大小/类型/实际后端。
- `createQueuedCase`现已接受调用者生成的sourceRecordId；Infra需要的可选`originalPath`初始登记由AI（audit-queue文件Owner）统一加入并同步fakes，避免两个Agent编辑同文件。

## 7. 文件唯一Owner

五个Agent分别使用`/tmp/contract-audit-omp-s2-{qa,infra,ai,ux,docs}`独立worktree，并从S1冻结提交开始。仍执行下列唯一Owner约定；Agent交回改动和交接说明，由Main创建功能提交、逐片集成、执行迁移及验证。Agent不得自行提交、迁移、启动共享服务，亦不得在实施中运行测试、lint、build或formatter。

| Owner | 可直接修改 | 不可直接修改/交接 |
| --- | --- | --- |
| Main | 本契约、CONTEXT/GLOSSARY、公共decision.ts、`apps/api/src/app.ts`、openapi.ts、主阶段矩阵/证据、最终CHANGELOG、迁移生成物和最终集成修复 | 对子Owner文件的需求先消息交接；最终统一批准接口 |
| Agent 1 QA | `.github/workflows/ci.yml`、root package.json（脚本）、playwright.config.ts、bunfig.toml、`scripts/qa*`、`tests/acceptance`既有用例（不含UX新增专用文件）、`tests/integration`、测试专用DB helper、DB测试、`docs/quality`（RELEASE-READINESS由Main整合） | 不改领域规则、生产DB schema/route/adapter；决策和存储单测由对应实现Owner写 |
| Agent 2 Infra | compose/Dockerfiles、`.dockerignore/.gitignore/.env.example`、`scripts/demo*`、`apps/api/src/demo/**`、demo-world路由、original-store及单测、上传route audit-cases.ts、audit-read-model.repository.ts、`docs/deployment` | 不编辑schema/migrations/audit-queue/fakes；表/字段需求交AI；不改README避免Docs冲突 |
| Agent 3 AI | `apps/api/src/decision/**`、routes/decisions.ts及单测、schema.ts、agent-trace.repository.ts、audit-queue.repository.ts、assemble-run-snapshot.ts、dispatcher.ts及对应测试、testing/fakes.ts、`tests/fixtures/decision/**`（保留S1合约样例）、scripts/decision/**、`docs/ai` | 不改app.ts/compose/env/root package.json或规范DTO；不执行migration/test/build；DTO变更先交Main批准 |
| Agent 4 UX | apps/web/**、`docs/ux`、新增`tests/acceptance/decision-advice.spec.ts`与`ux-workflow.spec.ts` | 不改backend/DTO/schema/既有acceptance文件与playwright.config；后端未就绪时仅测试使用合约fixture，不在产品里硬编码 |
| Agent 5 Docs | README、既有architecture/runbook的事实修订、`docs/competition`、`docs/engineering`、project-management/GANTT及可编辑历史计划 | 不改Main三份基线文件/本契约、QA/deployment/AI/UX文档、CHANGELOG与生产源码 |

若当前工作书和旧backlog Owner不同，以本轮唯一Owner表为准。AI schema编辑完成后冻结，Main再生成SQL/meta、check/migrate；Infra不能另开迁移。

## 8. UI与验收

- S1提供明确标为Fake的类型合约样例供UI测试，不能当实时模型记录。S2接入真实typed API；空、off、超时、失败、未校准和来源必须可区分。
- 建议只读展示；独立反馈注明不改变正式结论。风险确认/误报继续走现有人工复核，不能借影子反馈绕过。
- 优先修复已复现的375px风险/复核不可达；保留1440×900、1920×1080与1280宽桌面验证。复用现有tokens/组件，无全量框架迁移。
- QA修正旧重新运行Agent验收：新case、新Run、同Source Record/Contract Revision、旧案快照/发现/复核/整改不变；保留失败重试是另一条行为的覆盖。
- 至少60条中文合成/脱敏条款，十类、否定/例外/模糊/跨条款、标签理由与复核状态。未经人类专家签核只能称开发参考标签，不可宣称独立人工gold。
- 评测固定输入和Pi输出；不得把gold或comparison送给模型。文本独立评测与带规则信号的辅助路径分开报告。未调用的Pi/Laya路径明确未测，Fake不能冒充Pi或Laya质量。
- 最终统一运行verify、分层覆盖率、真实PG/Redis/S3、浏览器、Docker、两次reset与非demo哨兵保护；校验关闭/故障时正式结论不变。分支覆盖不可测则明确BLOCKED，不伪造比例。

## 9. Schema、错误、幂等与兼容

- `DECISION_SCHEMA_VERSION=1`；Request、ProviderResult、Failure、Advice、Feedback、List、Detail和ApiError均携带该版本。未知主版本返回unsupported_schema，不继续推理或正式写入。HTTP校验失败422，认证失败401，未知资源404，同一幂等键不同body409，内部失败500；决策错误体统一`{schemaVersion:1,error,requestId}`，不包含原始异常。
- 规范运行时校验为`packages/audit/src/decision-contract.ts`，复用项目已有TypeBox 1.3.27。Adapter先把Laya响应投影成规范结果，再调用`validateDecisionProviderResult`；错误返回类型化Failure，不抛带原文的远程异常。问题为受控目录，选项唯一；choice必须属于目录，score允许选项范围内的期望值；分布键完整且总和容差0.001，拒绝NaN/Infinity、越界概率、类型漂移及模型自授calibrated字段。
- ProviderResult为内部严格契约，新增必填字段或改变语义须提升主版本并迁移冻结输入；读取端忽略公开DTO的未知可选字段。已持久化旧记录不从新schema倒推补造模型结果，缺版本的历史run不派生shadow。
- 派生任务幂等性见第4节；反馈`Idempotency-Key`为受限可打印字符串，作用域为decisionId与actor；同键同body返回已存事件，不追加，异体409。缺键的每次提交是独立事件，客户端在一次提交及其网络重试间复用键。
- 请求超时、不可用、取消、非法请求/响应、未知schema、禁止出网与disabled分开记录。只有超时/暂时不可用可有界重试；规则与正式Finding保持原值。

## 10. 留存、发布与验收门禁

- 默认`DECISION_RETENTION_DAYS=30`，允许1–365；只对终态shadow记录及其反馈进行过期清理，不删除Source Record、Snapshot、Run、Finding、复核或整改。AI提供dry-run/apply入口与删除数量，活动租约不清理；不存原始provider body、完整提示词或密钥。冻结的最小脱敏输入仅服务恢复/哈希；公开详情不返回该输入。
- Main独占SQL/meta生成、check/migrate。仅增量新表/列/索引，旧run关联可空且不倒配；生产迁移不自动登记demo身份。回滚先`DECISION_MODE=off`并停worker，旧正式路径可用；保留新表和历史影子记录，不运行破坏性down。
- Laya前置门禁：固定代码/多语模型revision，本机CPU实际执行choice/score/noul中文请求并记录版本、耗时和资源。若下载、环境或中文质量失败，记录实际错误和已尝试步骤；off及明确Fake回放仍可交付，不能把研究或Fake当作Laya成功。完整校准研究、高级反馈分析及多版本实验明确延期P2，Jev取消。
- Main在每个可运行纵向切片提交后集成，先针对改动smoke再推进，不等待五个分支最后一次合并。schema共享变更在AI交接后统一生成；各工作树最终不运行独立迁移。11月5日起原则上仅缺陷/安全/文档修正，11月10日为V1目标，规划不是完成记录。

| Gate | S1可检查产物 | S2/S3必须提供的运行证据 |
| --- | --- | --- |
| G1 | versioned DTO、TypeBox解析、错误/幂等契约、边界测试 | API状态/版本与重试幂等行为 |
| G2 | Provider没有正式写权限；独立队列与冻结身份约定 | 同输入off/shadow正式规则、Finding、复核和整改一致；影子故障不污染成功 |
| G3 | 全API门禁、最小脱敏输入、保留与删除范围 | 匿名拒绝、授权原件/详情、模型请求无敏感标识、过期清理边界 |
| G4 | AI唯一schema Owner、Main唯一迁移执行者、增量回滚 | 新库及已有库迁移，off回退可用，不丢历史 |
| G5 | 本地Laya CPU前置实测及失败交付路径 | 固定revision中文真实推理；不可达/超时/错误不得伪报成功 |
| G6 | TASK-MATRIX逐项P0/P1/P2、Owner、依赖、工作量和证据 | 每行更新实际命令、状态与提交 |
| G7 | 五个独立worktree、目录Owner和持续集成约定 | 分片交接、主Agent提交与统一回归 |

S1契约测试已实跑18通过、0失败；正式服务端授权、影子持久化与UI仍属S2实施项，不因本页冻结而宣称实现。
