# 模型卡：Laya 多语 checkpoint（本地 CPU，影子观察）

本卡描述本系统实际使用的本地决策模型。**它不是对模型质量的背书**，也不重复厂商宣传数字。

## 1. 模型与来源

| 项 | 值 |
| :- | :- |
| 模型仓库 | `convaiinnovations/laya-multilingual`（HuggingFace） |
| 权重 revision | `1720e3e3357cfe1e281542e223f8273b0890ca34`（固定） |
| 服务代码 | `NandhaKishorM/laya`，commit `432312b36714d8889eba405507b37eda25257d9c`（`pyproject` 版本 `0.4.7`） |
| 许可证 | Apache-2.0（权重与代码分属同一项目方，均为 Apache-2.0 标识） |
| 运行方式 | 本地 HTTP，Jev 兼容 `/v1/systemone` 协议，CPU（torch CPU 构建） |
| 设备与并发 | CPU；`THREADS=4`；`MODELS=multilingual`；`MAX_LOADED=1` |
| 中文 | 多语 checkpoint 覆盖 100+ 语言；**中文质量未在本项目独立验证** |

## 2. 三个 primitive 的语义（按固定 SHA 源码）

| primitive | 上游输出 | 本项目如何记录 |
| :- | :- | :- |
| `choice` | 标签 + 每个选项的概率 + `confidence` | `answer.choice`；`rawProbabilities` 原样；`confidenceType=laya_entropy_concentration` |
| `score` | 序数**层级的期望值** + 各层概率 + `legend` | 映射回规范选项（层级 `i` → `options[i]`）；`rawProbabilities` 原样 |
| `noul` | `P(true)` ∈ [0,1] | `answer.noul`；`rawProbabilities=null`；`confidence=null`；`confidenceType=none` |

依据（固定 SHA 源码，非推断）：
- `laya/agent.py`：noul 输出 `round(float(p[1]), 4)`，即 true 类 softmax 概率；noul 的 `confidence = max(p[1], 1-p[1])`。
- `laya/common.py::confidence_from_probs`：`1 − H(p)/log(k)`，是分布**集中度**，不是正确率。
- `laya/serve.py::_project_jev_strict`：`LAYA_JEV_STRICT=1` 时 noul 线上只有 `{type, noul}`——没有概率、没有 confidence。因此适配器对 noul 记 `confidenceType=none`，**不**自行推导置信度。
- `laya/common.py` 注释与 README：多语 checkpoint **未拟合温度**，任何概率都须在独立数据上验证校准。

**noul 数值范围核实**：固定 SHA 源码中 noul 为 true 类概率，范围 [0,1]；不存在有符号 [-1,1] 语义。S1 校验器的 [0,1] 边界与上游一致，无需修正。

## 3. 校准状态

- `calibrated=false`，`calibrationVersion=null`，`thresholdPolicyVersion=null`，`threshold=null`，`uncertainty=uncalibrated`。
- **不**把 logits 或熵集中度宣称为概率正确率。
- **不**跨模型复用阈值。
- 多语 checkpoint 未拟合温度，因此不设自动路由阈值；影子阶段所有建议 `needsHumanReview=true`。

## 4. 已知失效模式（上游文档，针对 Jev 1.13 的 jaggedness 页；未证明 1.14 相同）

字面阅读（作用域词、否定、隐含条件）、数值/计数不可靠、日期按文本读、大 state 稀释准确率、对抗性 state 可影响答案、instructions 与 criteria 矛盾会混淆、**choice 选项顺序可能影响答案**。

本项目对策：数值/日期/计数留在确定性代码；问题来自受控目录；state 视为不可信数据；记录原始分布与版本；不启用自动路由阈值。

## 5. 本机实测证据（一次合成请求，非基准）

来源：`docs/project-management/evidence/laya-cpu-smoke.json`（Main 记录，持久路径）。

- 环境：Python 3.12.15、torch 2.14.1+cpu、transformers 5.19.0、laya 0.4.7（固定 SHA）、离线（`HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`）、device=cpu、threads=4。
- 权重下载 24.01s；依赖安装 30.22s（均一次）。
- 一次三 primitive 请求 HTTP 200，耗时 642ms：`choice` payment 0.9976、`score` 0.975（层级期望值）、`noul` 0.8963；usage input 247 / output 0；`calibrated=false`。
- 过程中真实 422 观测到的线上约束：每个问题必须带 `instructions`；`choice` 的 criteria 是 标签→描述 对象；`score` 的 criteria 是描述数组（索引 0 起）；`noul` 的 criteria 省略或为 `{true,false}`，**不能**是裸字符串。
- 单进程资源观测（Main，`/proc/<pid>/status`）：VmRSS 1,853,884 kB、VmHWM 2,441,520 kB、Threads 36、VmSwap 0。**这是一次进程快照，不是聚合评测峰值或生产容量结论。**

**边界**：以上是单个合成条款的三 primitive 观测，不构成中文准确率、合同域准确率、吞吐或生产收益的结论。

## 6. 不做什么

- 不用模型输出训练或蒸馏任何模型。
- 不把模型输出当作 Finding、规则结论或人工复核结论。
- 不把模型输出发送到外部服务；Jev 接入已取消。
