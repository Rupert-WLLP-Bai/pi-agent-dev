# 本地 Laya CPU 部署与冒烟（A0）

本文件是**可复现**的本地 CPU 部署、启动与冒烟步骤，对应 `scripts/decision/laya-setup.ts`。所有版本按 SHA 固定，torch 使用 CPU 构建，全程本地、无需任何密钥。

Main 已完成一次真实部署与推理（证据：`docs/project-management/evidence/laya-cpu-smoke.json`）。**不要并行启动第二个服务或重复下载权重**：HuggingFace 缓存与端口会被争用。

## 1. 前置条件

- Python 3.10+（实测 3.12.15）、`uv`（实测 0.13.0）。
- 内存：实测权重加载后单进程 VmRSS ≈ 1.77 GiB、VmHWM ≈ 2.33 GiB；留出余量。
- 网络：仅首次需要（下载权重与依赖）；之后离线可运行。

## 2. 固定版本

| 项 | 值 |
| :- | :- |
| 服务代码 commit | `432312b36714d8889eba405507b37eda25257d9c`（laya 0.4.7） |
| 多语权重 revision | `1720e3e3357cfe1e281542e223f8273b0890ca34` |
| 权重仓库 | `convaiinnovations/laya-multilingual` |
| torch | CPU 构建（`--index-url https://download.pytorch.org/whl/cpu`） |

## 3. 安装（一次性）

```bash
bun scripts/decision/laya-setup.ts install
```

等价手工步骤：

```bash
uv venv --python 3.12 /tmp/contract-audit-laya-cpu-venv
V=/tmp/contract-audit-laya-cpu-venv/bin/python
$V -m pip install --upgrade pip
$V -m pip install torch --index-url https://download.pytorch.org/whl/cpu
$V -m pip install "git+https://github.com/NandhaKishorM/laya.git@432312b36714d8889eba405507b37eda25257d9c"
$V -m pip install "laya[serve]"
```

实测：依赖安装 30.22s。

## 4. 校验环境（只读，不下载）

```bash
bun scripts/decision/laya-setup.ts verify
```

检查：隔离环境存在、Python 3.12、`laya` 可导入、torch 为 CPU 构建、固定 revision 的权重快照存在、requirements 文件存在。缺失项以 `FAIL` 行明确列出。

## 5. 启动离线 CPU 服务

```bash
bun scripts/decision/laya-setup.ts start
```

服务环境变量（`scripts/decision/laya-setup.ts` 中的精确值）：

```
HF_HUB_CACHE=<model cache dir>
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
LAYA_DEVICE=cpu
LAYA_THREADS=4
LAYA_MODELS=multilingual
LAYA_MAX_LOADED=1
LAYA_IDLE_UNLOAD_SECONDS=0
LAYA_PRELOAD=1
LAYA_REVISION=1720e3e3357cfe1e281542e223f8273b0890ca34
LAYA_EXTRA_MODELS={"multilingual":"convaiinnovations/laya-multilingual"}
LAYA_JEV_STRICT=1
```

注意：路由器的默认 bundle 指向另一个仓库，`LAYA_EXTRA_MODELS` 覆盖是让这个独立 revision 真正提供服务的必要条件。`LAYA_JEV_STRICT=1` 让 noul 走严格线上契约（只有 `{type,noul}`）。

首次权重下载实测 24.01s，无需 HF token。

## 6. 冒烟（三个 primitive）

```bash
LAYA_PORT=3847 bun scripts/decision/laya-setup.ts smoke
```

以一次请求同时问三个 primitive，并把**实际请求与响应**写入证据文件（默认 `artifacts/laya-cpu-smoke.json`）。非 200 时退出码非 0，且响应体原样记录——不重试成成功。

## 7. 线上契约要点（真实 422 观测所得）

| 约束 | 说明 |
| :- | :- |
| `instructions` | 每个问题都必须提供字符串 |
| `choice.criteria` | **对象**：标签 → 描述 |
| `score.criteria` | **数组**：层级描述，索引 0 起 |
| `noul.criteria` | 省略，或 `{true: 描述, false: 描述}`；**不能**是裸字符串 |
| `noul` 响应 | 严格模式下只有 `{type, noul}` |
| `choice`/`score` 响应 | 含 `confidence`（熵集中度）与 `probabilities` |

内部 `DecisionQuestion.criteria` 作为 `instructions` 发送；适配器按类型构造对应的 criteria 形状（见 `apps/api/src/decision/providers/laya-cpu.ts`）。`score` 的内部数值选项被投影到线上序数层级，答案再按选项顺序映射回来。

## 8. 与 API 的衔接

API 只有在 `DECISION_MODE=shadow` 且 `DECISION_PROVIDER=laya-cpu` 且 endpoint 出现在 `DECISION_ALLOWED_ORIGINS` 中时才会调用本服务；否则 `forbidden_outbound`。参见 `docs/ai/DECISION-ARCHITECTURE.md`。

## 9. 失败与阻塞记录方式

- 依赖下载失败 → 记录实际错误与已尝试步骤，保留 `off` 与 `Fake` 交付路径。
- 权重不可达 → 同上；**不得**把 Fake 结果当作 Laya 成功。
- 中文质量不达标 → 记录为限制，不声称通过。

本文件不声称已完成上述任何一项之外的验证；实测结论只引用带命令与输出的证据文件。
