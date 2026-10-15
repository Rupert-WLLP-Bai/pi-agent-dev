# 影子评测与基线对照（A4/A5）

状态：**已实现评测脚本与数据集**；**指标数值以实际运行输出为准**。本文不预填任何质量数字；未运行的路径标注"未测"。

## 1. 数据集（A4）

`tests/fixtures/decision/clauses.ts`：

- **60 条**合成中文条款，**10 类**（付款、违约责任、不可抗力、终止/续约、验收、管辖、隐私保密、主体、金额、附件冲突）。
- 每类含：正例、反例、模糊例，以及例外例或跨条款例（`kind: positive | negative | ambiguous | exception | cross_clause`）。
- 每条带 `reason`（标注理由）与 `reviewStatus`（`settled | needs_human_review`）。
- 跨条款引用以 `pairsWith` 关联，且有测试保证引用可解析。
- **标签性质：开发参考标签**（developer reference labels），由实现工程师按标准撰写，**未经独立人类专家签核**，因此**不得**称独立 gold 标准或宣称"人工标注准确率"。
- 全部条款为本项目撰写的合成文本；不含任何生产合同、客户材料或第三方文本。

数据集版本：`EVALUATION_INPUT_REVISION = "clause-fixture-v1"`（`scripts/decision/evaluate.ts`）。问题目录版本：`question-catalogue-v1`。两者随每次运行输出一起记录。

## 2. 评测方法（A5）

`scripts/decision/evaluate.ts`：

- **同任务、同输入**：每条 fixture 构造一个冻结 `DecisionRequest`，走与线上完全相同的受控问题目录与投影路径。
- **公平基线**：`--provider fake`（确定性离线演示路径）与 `--provider laya-cpu`（本地真实推理）使用同一 fixture、同一问题；两条路径的数字分别报告，不合并。
- **固定输入**：评测固定输入文本与请求；不把 gold 标签、comparison 答案或原文坐标发给模型——比较在本脚本内、模型返回之后进行。
- 文本独立评测与带规则信号的辅助路径分开报告；本轮未实现带规则信号的辅助路径，该路径**未测**。

## 3. 指标

对回答了问题的子集（`answered`）计算：

- 各类 Precision / Recall / F1 与 support；
- Macro-F1；Accuracy；
- 混淆矩阵（10×10，含把其他类误判为某类的情况）；
- 拒答/失败（`abstained` = 失败或未产出答案，单独计数，**不**折算成 0 分或 100%）；
- 时延 p50 / p95 / max（毫秒，本机实测）；
- 资源：单进程 RSS/HWM 由 Main 在集成评测时记录（`docs/ai/MODEL-CARD.md` 第 5 节是一点观测，非聚合结论）。

**不伪造**：provider 不可达时输出 `answered=0` 并以非零退出码结束；报告不会出现"0 分"或伪成功。

## 4. 运行

```bash
# 离线 Fake 路径（无服务、无凭据）
bun scripts/decision/evaluate.ts --provider fake --out artifacts/decision-eval-fake.json

# 本地 Laya CPU 路径（服务已由 Main 启动）
bun scripts/decision/evaluate.ts --provider laya-cpu \
  --endpoint http://127.0.0.1:3847 --allowed-origin http://127.0.0.1:3847 \
  --out artifacts/decision-eval-laya.json
```

输出为 JSON（含 `recordedAt`、provider 身份、模型/代码 revision、input revision、逐条结果与全部指标），供报告直接引用精确数值。

## 5. 分层冒烟（off/shadow 不变性、故障隔离、重启、反馈、保留期）

```bash
bun scripts/decision/smoke.ts
# 可选：同时探测已运行的本地服务
LAYA_ENDPOINT=http://127.0.0.1:3847 bun scripts/decision/smoke.ts
```

覆盖：影子成功/失败记录、正式状态不受影子影响的结构边界、租约互斥与过期恢复、派生幂等、反馈幂等与只追加、保留期候选与删除范围、真实服务探测（可选）。

## 6. 结果状态

| 路径 | 状态 |
| :- | :- |
| Fake（确定性演示） | 脚本可运行；数值以输出文件为准 |
| Laya CPU（本地真实推理） | 单次三 primitive 冒烟已实测（见 MODEL-CARD 第 5 节）；**全量 fixture 评测待 Main 集成后运行** |
| rules-only / Pi-only / rules+Pi 等对照 | **未实施**（需要重放固定 Pi 输出；明确不在本轮范围） |
| 带规则信号的辅助评测 | **未实施** |
| 置信度校准（ECE/Brier）、多模型实验 | **延期 P2** |
