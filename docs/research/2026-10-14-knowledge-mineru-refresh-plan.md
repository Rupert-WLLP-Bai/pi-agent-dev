# 知识资料、MinerU 与演示数据更新：调查事实

日期：2026-10-14。本轮仅研究与规划，未安装 MinerU、下载模型、导入资料或删除数据。具体设计等待分轮确认。

## 当前项目的事实与术语

当前领域语言以 `CONTEXT.md` 为准：Source Record 保存来源信息；Evidence 必须有来源与有界位置；Rule Assessment 是确定性评估；Rule Version 是发布后不可变的规则参数集；Validation Case 是标注的规则验证材料。网页提示词、权威规范、合同原件和验证案例不是同一种资料，不能混为一个可信等级。

`packages/audit/src/fact-builder.ts:48` 的 `POLICY_PARAMETER` 能追溯规则版本和参数值；它不是企业制度或法规原文的定位。若要让知识资料支持审计依据，应补上原始规范的出处、版本、适用范围与位置，并保持已完成快照的引用稳定。

当前 OCR Interface 是 `apps/api/src/document/ocr/types.ts` 的 `OcrPort`。识别结果包含页码、页内顺序、文本、引擎、总页数与降级页；`document-ir.ts` 生成稳定块 ID、文档 hash 与 Unicode code-point 偏移。当前没有 bbox 表达。

`apps/api/src/document/ocr/mineru.ts` 是占位实现：`enabled:false`，probe 提示未适配，recognizePdf 抛出未实现。配置 `MINERU_ENDPOINT` 不会直接接通。应先实测部署输出，再实现现有 Interface 的 MinerU Adapter。

## 补充 P0：OCR 配置与成功案件重新审计

用户报告 OCR 模型无法在系统中配置，已成功运行的许多案件也无法再次运行。本轮仅定位原因和规划验收，不执行修复。

- OCR 配置只有环境变量入口。`app.ts:125` 的健康探测 recognizer 在应用创建时构造；`document/index.ts:102` 的解析默认 recognizer 是另一个模块级缓存。模型设置页面的持久化与运行时刷新只用于文本审计。动态 OCR 配置必须让健康探测、合同解析和卷宗解析读取同一个已生效配置，同时记录每次解析实际使用的版本。
- 成功案件没有重跑入口。`audit-case-workbench.tsx:843` 仅在失败/取消/中断分支显示重试、重评按钮；`audit-cases.ts:125` 的 reassess 也明确排除已完成和待复核。现有 retry 服务端仅防止重排 RUNNING，不能据此直接开放成功案件重试：`dispatcher.ts:215` 会把新提案追加到同一案件，旧复核和新结论可能混在一起。
- 重试会复用旧快照；当前规则重评会保留已有 Contract Document 并重建规则快照，**不会重新 OCR**（`assemble-run-snapshot.ts:65`）。因此更换 OCR 模型后需要单独的重新解析路径，不能把它藏在 Agent 重试的含义里。

只读浏览器检查了 `/settings/providers` 的新增表单和现有待复核案件详情：表单只有文本模型字段，详情提供复核与轨迹但没有成功后重跑控制。未提交配置、未调用 retry/reassess、未改变人工复核数据。

候选方案：在模型管理中分开配置审计模型和文档识别（视觉模型 / MinerU / 关闭），保存后对下一次解析生效；已成功的合同新增“重新审计”入口，创建独立审计轮次并保留旧复核历史。它应与失败重试、仅重跑 Agent、重新 OCR 的语义区分，具体归档到新 Audit Case 还是同案独立轮次等待用户确认。

验收：界面可保存并检测 OCR、重启后配置仍在、下一次扫描件解析采用新配置；已完成/待复核材料能启动新审计，原始资料、旧快照、Agent 轨迹和人工决定仍可查询；同一材料运行中不能重复启动。

## 本机与部署前提

| 实测项 | 结果 |
| --- | --- |
| GPU | NVIDIA GeForce RTX 2060 |
| Compute capability | 7.5，Turing |
| 显存 | 6144 MiB，总空闲量在检查时为 4892 MiB |
| NVIDIA driver | 617.42 |
| WSL RAM | 19 GiB 总量，约 14 GiB available |
| WSL swap | 5 GiB |
| WSL 文件系统 | 显示 907 GiB 可用；稀疏虚拟磁盘实际增长受宿主空间约束 |
| Windows C 盘 | 约 600 GiB 可用 |
| Python 环境工具 | uv 0.13.0 已安装 |
| Docker runtimes | 包含 nvidia、runc、io.containerd.runc.v2 |

验证命令：`nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version,compute_cap --format=csv`、`free -h`、`df -h . /mnt/c`、`uv --version`、`docker.exe info --format '{{range $name, $_ := .Runtimes}}{{$name}} {{end}}'`。未运行 GPU 容器或 MinerU，runtime 列表不能证明容器内 CUDA 已经工作。

## 当前 Docker 演示库清理范围

只读 SQL 查的是当前 Compose PostgreSQL 的 `contract_audit` 库，不代表所有本机数据库、磁盘目录或对象存储内容。

| 数据 | 数量 |
| --- | --- |
| Contracts | 35 |
| Contract Revisions | 36 |
| Source Records | 108 |
| Audit Cases / Audit Snapshots | 各 36 |
| 种子案件 / 非种子案件 | 33 / 3 |
| 待复核 / 已完成案件 | 22 / 14 |
| Agent Runs / Trace Steps | 3 / 37 |
| Finding Revisions | 50，其中人工复核记录 7 |
| Remediations | 5 |
| Rules / Rule Versions | 各 19 |
| Validation Cases / Validation Runs | 96 / 0 |
| LLM Providers | 1 |
| 记录了 original_path 的 Source Records | 0 |

数据库没有原件路径不等于 RustFS bucket 或本地上传目录为空；实际清理原件需要另做对象清单。规则、已发布参数、验证材料、模型配置和迁移日志应与演示案件分开处理。

`bun run seed:demo` 的 CLI 明确传 `reset:true`，但底层 `deleteDemoSeededCases()` 只删除带 `demoSeed` 标记的来源及其关联业务数据，然后再次生成场景与 filler。它不是清空所有业务数据的命令，不能代替本次数据更新方案。

候选清理路线：

1. 先备份现有库并验证可恢复；保留 `.env` 与模型凭据加密配置。
2. 优先建立新的演示库并应用已提交 migrations，保留旧库可切回。规则、参数、96 个验证案例和模型配置单独保留/迁移，避免把旧审计结果混入新数据。
3. 若选择清理原库，仅处理确认范围内的业务关系，按外键与 JSON 中的来源引用成组处理，事务提交前给出实际受影响对象清单；不删除规则、模型或 migration journal。
4. 新数据按来源清单逐批导入，保留原件及出处，不让资料更新改写已有审计快照。

以上都是候选方案，未执行。

## 已记录的真实卷宗

历史调查 `docs/research/2026-09-14-ict-项目卷宗现状调研.md` 记录过 5 个客户项目、187 个文件，以及收入合同/支出合同/测算表场景。历史文档有授权说明，但不能替代对当前文件可达性和当前导入范围的核对。

本轮未在文档记录的 `/home/pejoy/Downloads/项目打包` 和 Windows Downloads 的同名位置发现该目录。尚不能把历史调查记载的材料数量算作当前可导入数据；可在用户指出现有位置后继续核对。

## 候选设计树

- 知识资料用途与可信等级 → 准入审核、版本与适用范围 → 查询与引用进入审计快照的方式。
- MinerU 试验环境与后端 → 实测文件、页数、资源与失败边界 → OCR Adapter 与原件定位。
- 清理路线与保留边界 → 备份/切换/回滚 → 新资料导入。
- 第一批新资料来源 → 场景与风险标注 → 质量验收及后续扩充。

这些分支先确认上层选择，再确认依赖它的细节；不会把候选方案写成已接受的领域模型或实施决定。
