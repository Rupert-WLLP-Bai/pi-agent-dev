# MinerU 官方部署重新调研（试验环境）

日期：2026-10-14。本轮仅做部署调研与规划，**未安装 MinerU、未下载模型、未启动任何推理或容器**。所有版本号、路由、依赖范围与体积均来自官方源码/文档/PyPI/HuggingFace 实测，未见证的行为在文中显式标注。

## 1. 本机实测前提（已核对）

| 项 | 实测值 |
| --- | --- |
| GPU | NVIDIA GeForce RTX 2060，6144 MiB 总量，检查时 4771 MiB 空闲 |
| Compute capability | 7.5（Turing，TU106） |
| 驱动 / CUDA UMD | 617.42 / 13.4 |
| WSL 内存 | 31 GiB 总量，约 27 GiB available |
| Python 工具 | uv 0.13.0；系统 Python 3.14.7（未装 torch） |
| Docker | 已装，runtime 列表含 `nvidia`；**未跑过 GPU 容器**，不能据此认为容器内 CUDA 可用 |
| Vulkan | 只有 mesa/lvp/virtio 等软件 ICD，**未安装 NVIDIA Vulkan ICD**（`/usr/share/vulkan/icd.d/` 无 nvidia 项） |
| 磁盘 | WSL 根 907 GiB 可用；`C:` 595 GiB 可用 |
| 模型源网络 | huggingface.co 200，modelscope.cn 200（可达） |
| `~/.mineru` | 不存在（未下载过模型） |

## 2. 语料实测

`/home/pejoy/cqyd/hjs/materials/project-dossiers/项目打包`：187 个文件、54 个 PDF，与任务描述一致。天翼五期相关文件在 `天翼/天翼五期/甄选` 与 `天翼/天翼五期/立项`：

- `天翼五期/立项/收入合同扫描.pdf`：24.6 MB，RICOH MP 3555 扫描，**34 页**，A4 横向、页面旋转 270°，`pdftotext` 提取 34 字符（即**无文本层**，是真正的扫描件）。
- `天翼五期/立项/【收入合同】天翼数智（五期）.docx`：71.5 KB。
- `天翼五期/甄选/收入测算（天翼数智五）.xlsx`：13.9 KB。
- 未在天翼五期目录中找到「支出合同」文件（`find -iname '*支出*'` 命中的是马消、长安、富民项目）。这四件套中"支出 DOCX"当前不可用，其余三件齐备。

## 3. 版本事实：MinerU 4.0 已取代 3.x

- **PyPI 最新稳定版 `mineru==4.0.12`，发布于 2026-10-11**；`requires_python >=3.10,<3.15`（[PyPI JSON](https://pypi.org/pypi/mineru/json)）。
- 3.x 已终止：3.4 发布于 2026-06-18，是 3.x 最后一版；3.4 之后 changelog 的 "Unreleased" 与 "4.0" 章节全部围绕 4.0（[官方 changelog](https://opendatalab.github.io/MinerU/reference/changelog)）。
- 4.0 的命令入口是 `mineru-kit`（stateless）与 `mineru`（文档库/Agent），**3.x 的 `mineru -p`、`mineru-api`、`mineru-gradio`、`mineru-models-download` 已废弃**；`mineru[core]/[pipeline]/[vlm]/[vllm]/[lmdeploy]/[gradio]/[all]` 这些 extras 在 4.0 已不存在（[迁移指南](https://opendatalab.github.io/MinerU/reference/migration_4/)）。
- 4.0 的 "backend" 概念改成 4 个 tier：`flash`（原生文本/Flash OCR）、`basic`（ONNX 或 Torch 小模型，无需 VLM）、`standard`（小模型 + VLM）、`advanced`（同 standard，effort 更高）。**没有 `pipeline` / `vlm` / `hybrid` backend 名字了**（[tiers](https://opendatalab.github.io/MinerU/usage/tiers/)）。3.x 的 `hybrid` backend 对应 4.0 的 `standard`。
- 许可：3.1.0 起从 AGPLv3 改为基于 Apache 2.0 的 MinerU Open Source License（changelog 2026/04/18 条目），本机自用风险低，但对外分发仍需读 LICENSE.md。

## 4. 6GB 显存可行性：与 bf16 / SM75 / flash-attn 分开看

必须把三件事拆开，否则会误判"6GB 不能用"或"6GB 一定快"：

**(a) SM75 与 vLLM 本体：支持。** vLLM 官方要求 compute capability ≥ 7.5，并点名 RTX20xx/T4（[docs.vllm.ai GPU](https://docs.vllm.ai/en/stable/getting_started/installation/gpu/)）。MinerU 官方 Dockerfile 的注释同样写明 base image 覆盖 7.0 ≤ CC ≤ 12.1。所以"RTX 2060 跑不了 vLLM"是错的。

**(b) bf16：不支持，这是真正的硬约束。** VLM 权重 `opendatalab/MinerU2.5-Pro-2605-1.2B` 的 `config.json` 写的是 `"dtype": "bfloat16"`（实测 HF raw 文件）。Turing 的张量核心只有 FP16/INT8，没有 bf16 矩阵单元；vLLM 对 CC < 8.0 且 dtype=bfloat16 直接 `ValueError: Bfloat16 is only supported on GPUs with compute capability at least 8.0`（vLLM issue #1157/#1144）。**缓解手段：显式传 `--dtype half` / `dtype=torch.float16`**，走 FP16 而非 bf16。MinerU 源码里没有给 vLLM 自动加 `--dtype`：`mineru/kit/vlm_server/vllm_server.py` 只补 `--port`、`--gpu-memory-utilization`、`--logits-processors`，其余参数透传给 `vllm serve`，所以 `--dtype half` 可以且必须由调用方显式加。

**(c) flash-attention / V1 引擎特性：不确定，需实测。** MinerU 源码 `enable_custom_logits_processors()` 对 CC < 8.0 有显式分支：vllm ≥ 0.10.2 时**仍然启用**自定义 logits processor（`mineru/model/vlm/engine_utils.py:40-60`）。即官方代码认为 SM75 + 新 vLLM 是可工作路径。但"FlashAttention-2 / V1 特性是否在 SM75 全量可用"取决于 vLLM 版本与 kernel 编译，**本机未运行过，不能断言**；这是试验第一项要验证的。

**(d) 6GB 显存与 vLLM 的 KV 预算：官方代码有明确策略。** `set_default_gpu_memory_utilization()`：显存 > 8GB 时按 6GB 预算分配；≤ 8GB 时对 vLLM ≥ 0.11.0 也按 6GB 预算。对 6144 MiB 的 2060，走的是 `min_memory=4`（vllm<0.11.0）或 `min_memory=6`（vllm≥0.11.0）分支，即 `gpu_memory_utilization ≈ 0.65~0.98`。VLM 权重 FP16 约 2.2 GiB（`model.safetensors` 实测 2205 MiB），加上视觉编码器激活与 KV cache，**6GB 是紧的但官方把它当作可规划档位**；README 的资源表也写 `standard/advanced` 需要 "8 GB+ VRAM"，本机低于该推荐值，属"低于推荐、需实测"而非"不支持"。批量大小 `set_default_batch_size()` 对 < 8GB 返回 **1**，即自动串行，无需手动调。

**(e) 内存与 CPU：** tiers 文档建议 ≥ 16 GB 系统内存以获得较高吞吐；本机 27 GiB available 足够。torch 小模型路径还需要 `torch>=2.7.0,<3`、`transformers>=5.10.1,<6`；vLLM 侧 MinerU 声明 `vllm>=0.19.1,<0.29.0`（PyPI `requires_dist` 实测），而 PyPI 最新 vllm 已是 0.31.0——**若直接 `uv pip install "mineru[full]"`，解析器会落在 0.28.0（实测该版本满足 `<0.29.0`，且 wheel 为 `vllm-0.28.0-cp38-abi3-manylinux_2_28_x86_64.whl`，pin `torch==2.13.0`）**。这解决了"torch 版本上限"顾虑：4.0 不再有 3.x 时代 `torch<2.8.0` 的封顶（changelog 3.0.0 明确说已解决 torch ≥ 2.8 兼容）。

**(f) Docker 路线在本机的额外障碍：** 官方 `docker/global/Dockerfile` 基于 `vllm/vllm-openai:v0.21.0`（CUDA 13.0，可选 cu129），固定 `MINERU_MODEL_SMALL_BACKEND=torch` + `MINERU_MODEL_VLM_ENGINE=vllm`。它没有 bf16 规避（镜像内 vllm serve 默认读 config.json 的 bfloat16），**在 SM75 上大概率需要自己加 `--dtype half` 或改配置**；且 WSL 里 GPU 容器未验证。因此首选不是 Docker。

## 5. 模型体积（HF API 实测）

| 用途 | 仓库 | 体积 |
| --- | --- | --- |
| basic/standard 小模型（Torch） | `opendatalab/MinerU-4_models_torch` | **0.83 GiB**（14 文件；最大为 PP-FormulaNet_plus-M.pth 588.9 MiB、PP-DocLayoutV2 204.8 MiB） |
| basic/standard 小模型（ONNX） | `opendatalab/MinerU-4_models_onnx` | **0.80 GiB**（16 文件） |
| VLM 原始权重（vllm/lmdeploy/mlx） | `opendatalab/MinerU2.5-Pro-2605-1.2B` | **2.17 GiB** |
| VLM GGUF（llama.cpp） | `jinzhenj/MinerU2.5-Pro-2605-1.2B-GGUF` | **1.16 GiB**（Q8_0 主模型 506.5 MiB + mmproj 676.5 MiB） |

仓库 ID 与文件名来自 MinerU 源码 `mineru/model/registry.py`（master，实测），不是第三方转述。注意 GGUF 仓库是**社区账号 `jinzhenj`** 而非 `opendatalab`，ModelScope 同名路径也存在；llama.cpp 路线会引入非官方仓库权重。

## 6. 试验路线选择：先 CPU-only 打通，再按证据上 GPU

**结论：用隔离的 WSL uv venv，不用 Docker、不动系统 Python。** 依据：(1) 官方文档把 uv 作为推荐安装方式；(2) Docker 镜像锁定 torch+vllm 组合，缺 bf16 规避且 GPU 容器未验证；(3) uv venv 可回滚、可复现，且 3.x extras 已不可用必须走 4.0 的新 extras。

分三步，每步都有明确的可否判据：

### 步骤 A：零 GPU 基线（必做，成本最低）
```bash
cd /home/pejoy/cqyd/hjs/pi-agent-dev
uv venv --python 3.12 .venv-mineru
source .venv-mineru/bin/activate
uv pip install -U "mineru>=4.0,<5"
mineru-kit models show
```
- 这一步**不下载 VLM**：base 包含 ONNX 小模型运行时 + llama.cpp + WebUI。
- 验证扫描件走 Flash OCR 通路（无需 VLM 权重）：
```bash
mineru-kit parse \
  "/home/pejoy/cqyd/hjs/materials/project-dossiers/项目打包/天翼/天翼五期/立项/收入合同扫描.pdf" \
  -o /tmp/mineru-out/合同扫描.md --tier flash --ocr-mode ocr
```
- `mineru-kit models show` 会报告 `Effective small backend` / `Effective VLM engine`（文档明言它只显示、不校验；缺文件不失败）。

### 步骤 B：basic tier（GPU 可选）
```bash
mineru-kit models download --tier basic --source huggingface
mineru-kit models verify --tier basic
mineru-kit parse <上面同一个 PDF> -o /tmp/mineru-out/basic.md --tier basic
```
basic 只需小模型包（0.8 GiB），**没有 VLM、没有 bf16 问题、没有 vLLM**，是 6GB 显存下最稳的解析质量档。ONNX 小模型默认跑 CPU（tiers 文档：CPU 环境自动 ONNX/CPU）。

### 步骤 C：standard tier（VLM，本机的风险点）
```bash
mineru-kit models download --tier standard --small-backend torch --vlm-engine vllm --source huggingface
mineru-kit models verify --tier standard --small-backend torch --vlm-engine vllm
mineru-kit parse <PDF> -o /tmp/mineru-out/std.md --tier standard
```
若 vLLM 在 SM75 上因 bf16 失败（报错含 `Bfloat16 is only supported on GPUs with compute capability at least 8.0`），改用 llama.cpp（Vulkan/CPU）路线，**不装 vLLM**：
```bash
mineru-kit models download --tier standard --small-backend onnx --vlm-engine llama-cpp --source huggingface
export MINERU_MODEL_SMALL_BACKEND=onnx
export MINERU_MODEL_VLM_ENGINE=llama-cpp
mineru-kit parse <PDF> -o /tmp/mineru-out/std-llama.md --tier standard
```
llama.cpp 路线需注意：`mineru-llama-cpp` wheel 内分发 `llama-server` + `libggml-vulkan.so`（实测包 44 MB），默认 `n_gpu_layers=99` 尝试上 GPU；本机**未装 NVIDIA Vulkan ICD**，因此第一次运行大概率回退 CPU（llama.cpp 无 Vulkan 设备时自动 CPU）。这是可用但慢的路径，不是失败。

**CPU fallback（最低资源）**：`flash --ocr-mode ocr` 或 `basic`，仅小模型 + ONNX/CPU，README 资源表标 basic 最低 2 GB RAM、CPU 可跑。本机完全满足。

## 7. localhost HTTP 路线与响应结构（供 OcrPort 适配）

服务入口与路由均来自官方文档 + master 源码 `mineru/parser/api_server.py`、`mineru/parser/task_api.py` 实测：

```bash
mineru-kit api-server --host 127.0.0.1 --port 8000 --tier standard
```

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/v1/health` | GET | `{"status":"ok","version":"4.0.x","features":{"webhook":false,"output_formats":[...],"sources":[...]}}`；模型预载失败时返回 503 |
| `/v1/tiers` | GET | 本服务实际可用的 tier 列表 |
| `/v1/models` | GET | 只广告一个虚拟模型 `mineru-<version>`，质量由请求 tier 决定 |
| `/v1/file_parse` | POST | 一次性同步解析（multipart/raw bytes/JSON），`wait_timeout` 默认 300s（1–3600），超时返回 202 + task_id/status_url/result_url |
| `/v1/tasks` | POST | 异步提交，立即返回 202 |
| `/v1/tasks/{task_id}` | GET | 状态查询 |
| `/v1/tasks/{task_id}/result` | GET | 终态取结果（内联 JSON 或 zip） |
| `/docs` | GET | OpenAPI（`MINERU_API_ENABLE_FASTAPI_DOCS` 控制） |

**4.0 不再有 3.x 的根级 `/file_parse` 或 `/tasks`**（无 `/v1` 前缀的旧路由不可用，迁移指南明示）。这一点与 `apps/api/src/document/ocr/mineru.ts` 现有占位实现假设的端点不同，实现时必须用 `/v1` 前缀。

最小可复现调用（同步 multipart，直接拿 Markdown + Middle JSON）。**注意 `output_formats` 必须重复传查询参数，不能用逗号分隔**——源码 `mineru/parser/task_api.py:180` 用 `request.query_params.getlist("output_formats")` 读取，官方示例脚本 `scripts/http_task_example.sh:43` 也是 `query.extend(('output_formats', value) for value in formats)`：
```bash
curl -sS 'http://127.0.0.1:8000/v1/file_parse?tier=basic&ocr_mode=ocr&output_formats=markdown&output_formats=middle_json' \
  -F 'files=@/home/pejoy/cqyd/hjs/materials/project-dossiers/项目打包/天翼/天翼五期/立项/收入合同扫描.pdf' \
  -o /tmp/mineru-http/result.json
```

### 请求体编码的硬约束（源码 `_prepare_submission`，实测）

| Content-Type | 文件字段 | 选项位置 | 约束 |
| --- | --- | --- | --- |
| `multipart/form-data` | 字段名必须是 **`files`**，可重复多个 | 查询参数 | **除 `files` 外不得有任何其他表单字段**（`any(key != "files" for key in form)` 即 400 `param="files"`）；`filename`/`sha256sum` 在此模式下被显式拒绝（仅裸字节上传支持） |
| `application/octet-stream` | 整个 body 即文件 | 查询参数 | 必须带 `filename` 查询参数与 `Content-Length` 头，缺一即 400/411；可选 `sha256sum` 做命中缓存 |
| `application/json` | `files[]` 用 `source:{type:"file_id"|"url"|"inline"|"local"}` | **请求体** | **带任何查询参数都会 400**（`"JSON parse options must be supplied in the request body"`）；`local` 源需服务端 `--allow-local-source` |

JSON 体即 `CreateJobRequest`：`files[]`（`{source:{type,file_id|url|name+data|path}, page_range}`，1–100 项）、`tier`、`ocr_mode`、`output_formats`（默认 `["markdown"]`）、`callback`（本地服务不支持，传即 400）。`source` 是 `type` 判别联合，四种类型字段名互不相同。

`UploadTaskOptions` 是 `extra="forbid"`，字段只有 `tier`、`ocr_mode`、`page_range`、`output_formats`、`filename`、`sha256sum`——多传任何查询参数都会 400。

### 查询参数精确语义

- `output_formats`：仅接受 `markdown`、`middle_json`、`structured_content`、`zip`；**重复传参**，空列表或含非法值即 400。
- `response_format`（`json`|`zip`）与 `wait_timeout`（1–3600，默认 300）**只属于 `/v1/file_parse` 同步路由**；在 `/v1/tasks` 上传这两个会因 `extra="forbid"` 被 400。异步取 zip 的方式是提交时 `output_formats=zip`，再 `GET /v1/tasks/{id}/result?response_format=zip`。
- `page_range` 语法 `1-5,8`，`r1` 表示最后一页，`all` 全部；越界区间取有效交集，反向/空区间报 `page_range_invalid`。
响应为 `TaskResultResponse`：顶层 `task_id`/`status`/`tier`/`output_formats`，`files[]` 每项含 `file_id`、`name`、`page_range`、`status`（`queued|running|completed|failed`）、`output_files`（按 purpose 分组的 file_id 引用）与 `content`（请求的文本产物内联在此）。终态 job 状态：`completed|partial|failed|canceled`；`partial` 表示部分文件成功，需按文件逐个判断。单文件上限 200 MiB、单任务 100 文件。

### 状态码与错误定位（源码 `build_task_result`，实测）

- 非终态（`queued`/`running`）取 result → **202**，body 仍是 task payload（含 `task_id`/`status_url`/`result_url`）。
- 终态 `failed`/`canceled` → **HTTP 409**，body 仍是那个 payload，失败原因在每个 `files[].error`（`{type,code,message}`）。
- `wait_timeout` 超时 → **202**，任务在后台继续。**两种 202 的 body 形状相同，必须用 `status` 字段判断，不能只看 HTTP 码。**
- 成功时 `content` 的 key 就是请求的 output_formats 名：`content.markdown` 是 str，`content.middle_json` / `content.structured_content` 是已解析的 dict；单文件 failed 时该文件 `content` 为空 `{}`。
- 顶层还有 `progress`（`{completed,failed,total}`）与每文件的 `parse`（`{model_used,duration_ms,parser_version}`），做进度条和"实际用了哪个模型"的记录时可直接用，不必自己算。

### 鉴权范围（源码 `_auth_middleware`，实测）

`_PUBLIC_PATHS = {"/v1/health", "/v1/models", "/v1/tiers"}` 加上 `/v1/models/` 前缀与 `/openapi`、`/docs`、`/redoc` 前缀**永远免鉴权**。只有 `--api-key` 设置后，其余 `/v1/*` 才要求 `Authorization: Bearer <key>`，否则 401 `invalid_api_key`。**因此 `/v1/health` 探测不需要凭据**，可在 UI 上无 key 探活。另外注意：`html`/`latex`/`docx` 三种 output_formats 匿名一律 403 `feature_requires_api_key`（这三者也不在本地服务的合法格式集合里，会先撞 400 `unsupported_output_format`）。

### bbox 与表格结构（OcrPort 当前没有 bbox，这是新信息）

- Middle JSON 的 block **有 `bbox`**：docvortex `BlockBase` 定义 `bbox: tuple[float,float,float,float] | None`，校验为 **0–1 归一化**坐标（`schema.py:469`，实测 wheel `docvortex-0.5.16`）。顶层 block 在固定版式文档中强制要求 bbox。
- `middle_json` 之外，MinerU 4.0 的 Content List V2 渲染把 bbox 转成 **0–1000 整数框**（`normalize_bbox`，`render/_internal/content_list/common.py:118`），并按页分组输出。
- 表格以 **HTML** 形式给在 V2 item 的 `content.html`，另有 `table_type` 与 `table_nest_level` 字段（`render/_internal/content_list/v2.py:246-259`）；表格本体同时可能带 `image_source`。
- 因此适配 `OcrPort` 时：**文本块顺序可用 `page_idx` + block `index` 直接映射到现有 `OcrBlock{page,index,text}`**（page 需 +1）；bbox 与表格 HTML 属于现有 `OcrBlock` 没有的能力，是否扩展类型需主决策，本报告不建议擅自改 `types.ts`。

## 8. 明确的未知项（不要当成已验证）

1. **vLLM 在 SM75 + FP16 下能否实际跑通 MinerU2.5-Pro-1.2B**：官方代码路径与官方 GPU 门槛都指向"可以"，但本机未执行，bf16 报错后的 `--dtype half` 是否够用（是否存在其他 kernel 回退问题）未验证。
2. **flash-attention / V1 特性在 SM75 的可用性**：未运行，不能断言。
3. **GPU 容器**：`nvidia` runtime 已列，但未跑过 GPU 容器；容器内 CUDA 是否工作未知。
4. **llama.cpp Vulkan**：wheel 含 `libggml-vulkan.so`，但本机无 NVIDIA Vulkan ICD，实际能否用上 GPU 未知（预期回退 CPU）。
5. **34 页扫描件的实测耗时与显存峰值**：未运行，无法给数。唯一可引用的是官方默认并发/批大小为 1（< 8GB 显存分支）。
6. **支出合同 DOCX**：天翼五期目录中不存在，四件套不完整；需要用户指认路径或改用其他项目的支出合同做对照。
7. `--tier standard` 首次解析的模型下载是否走通、HF 与 ModelScope 的实际下载速度，未测（两者首页均可达）。

## 9. 与现有代码的衔接点（只作定位，不改代码）

- `apps/api/src/document/ocr/types.ts`：`OcrPort`/`OcrResult`/`OcrBlock` 契约；`OcrBlock` 注释明确"刻意没有 bbox，不可信的框比没有更糟"。上文第 7 节说明 MinerU 的 bbox 是归一化坐标且固定版式强制存在，与"视觉模型坐标不可信"的顾虑不同源（这是版面分析器输出，不是 VLM 目测），但是否采信仍需产品决策。
- `apps/api/src/document/ocr/mineru.ts`：`createMineruOcrPort(endpoint)` 目前 `recognizePdf` 抛"未实现"。实现时应把 endpoint 当作 **V1 API 根**（`http://127.0.0.1:8000`，不是 `.../v1`），内部拼 `/v1/file_parse`，并在 probe 阶段打 `/v1/health`（读 `features.output_formats` 判断可用产物）。
- `apps/api/src/document/ocr/index.ts`：`createOcrPort()` 在 `config.provider === "mineru"` 时返回该占位端口；`MINERU_ENDPOINT` 环境变量已存在但未接线。
- 适配器要处理的语义差：MinerU 的 `ocr_mode`（`auto|txt|ocr`）与"扫描件判定"、`tier`（flash/basic/standard/advanced）与现有 provider 枚举、`partial` 状态与现有 `degradedPages` 的映射，都是新增决策点。

## 10. 引用

- MinerU 4.0 README（dev/master）：https://github.com/opendatalab/MinerU
- Changelog（3.4 / 4.0 / Unreleased）：https://opendatalab.github.io/MinerU/reference/changelog
- Tiers and runtimes：https://opendatalab.github.io/MinerU/usage/tiers/
- Quick start / extension modules：https://opendatalab.github.io/MinerU/quick_start/ 、https://opendatalab.github.io/MinerU/quick_start/extension_modules/
- Model source：https://opendatalab.github.io/MinerU/usage/model_source/
- V1 HTTP API：https://opendatalab.github.io/MinerU/usage/http_api/
- Python SDK：https://opendatalab.github.io/MinerU/usage/sdk_api/
- Docker deployment：https://opendatalab.github.io/MinerU/quick_start/docker_deployment/
- Output formats / MiddleJson：https://opendatalab.github.io/MinerU/reference/output_files/
- 源码（master）：`mineru/model/registry.py`、`mineru/parser/api_server.py`、`mineru/parser/task_api.py`、`mineru/model/vlm/engine_utils.py`、`mineru/model/vlm/selector.py`、`docker/global/Dockerfile`
- PyPI：`mineru` 4.0.12、`vllm` 0.28.0/0.31.0、`torch` 2.14.1、`docvortex` 0.5.16、`mineru-llama-cpp` 0.1.3
- vLLM GPU 要求（CC ≥ 7.5）：https://docs.vllm.ai/en/stable/getting_started/installation/gpu/
- bf16 需 CC ≥ 8.0：https://github.com/vllm-project/vllm/issues/1157
