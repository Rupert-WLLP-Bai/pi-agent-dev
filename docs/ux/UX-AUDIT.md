# UX 走查与改造记录（S2）

> 范围：`apps/web/**`。本文记录上传→证据→复核→整改的实地走查发现、已实施的修改、未修改项及其理由，以及主 Agent 需要执行的浏览器验证方案。
>
> 本文只陈述在代码与验收中可以观察到的内容。凡未实际运行的检查，均标注为「未运行」或「待 Main 验证」，不填写未观测到的比例、耗时或提升数字。

## 1. 走查方法

- 以运营商内部审计人员角色，按「上传合同 → 审计进度 → 风险定位 → 证据确认 → 人工复核 → 整改/追溯」顺序操作现有界面。
- 走查基线为 S1 冻结提交 `6a59906`；界面证据来自 `apps/web` 现有实现与既有 Playwright 验收（`tests/acceptance/*.spec.ts`）。
- S1 既有全流程验收结果记录为 37 通过 / 1 失败，其中失败项与一处真实的 375px 复核可访问性缺陷相关。该缺陷已在本次修复（见 §3.1），修复后的实际通过数由 Main 在集成后重新运行得出，本文不预先填写。

## 2. 已确认缺陷

### 2.1 375px 下风险发现与复核操作不可达（已修复）

**现象**：视口 ≤767px 时 `.review-workspace` 折叠为单列，同时 `.finding-nav` 与 `.inspector` 被 `display: none` 隐藏。结果是：

- 风险发现列表完全不可见，无法选择发现；
- 依据与复核栏不可见，「确认风险」「判定误报」两个复核操作无法触达；
- 审查覆盖入口同样不可达。

在 375px 宽度上，一个待复核案件因此既看不到风险，也无法完成复核——移动端只能查看合同原文。

**根因**：`apps/web/src/styles.css` 的 `@media (max-width: 767px)` 块直接把两栏设为 `display: none`，没有提供替代触达路径。

**修复**：`apps/web/src/components/audit-case-workbench.tsx` 增加 `review-pane-switch` 三选一切换器（风险发现 / 合同原文 / 依据与复核），工作区挂 `data-mobile-pane` 属性；样式改为只隐藏未选中的栏。桌面宽度下切换器 `display: none`，三栏仍同时可见，桌面行为不变。

**约束保持**：切换只改变可见栏，不改变任何案件状态、发现选择逻辑或复核语义。

### 2.2 审计失败原因对操作员不可读（已修复）

**现象**：`Agent Run` 的 `error` 原样展示为内部错误码（如 `LLM_UNREACHABLE`），操作员无法据此判断该重试还是该改配置。

**修复**：`apps/web/src/audit-presentation.ts` 新增 `describeRunError`，为已知稳定码提供中文说明与处置提示，未知码原样透传（不伪装成通用失败）。`apps/web/src/routes/audit-trace.tsx` 改用它。

**安全出网相关文案**（对应服务端 `MODEL_DATA_OUTBOUND_FORBIDDEN` / `MODEL_DATA_DESTINATION_INVALID`）：

> 该模型地址尚未获准处理内部合同，请联系管理员配置受信处理域，或使用未修改的标准合成合同演示。

文案明确要求走管理员配置或标准合成合同路径，不引导上传原始合同绕过策略。

## 3. 已实施改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/decision-presentation.ts` | 新增。影子建议的呈现规则：状态/提供方/任务类型标签、答案呈现、原始分布、置信与校准（区分集中度/自评分/无、未经校准/不可用/已校准+阈值）、同命题分歧、证据锚点、失败原因翻译、空/关闭态区分。 |
| `apps/web/src/components/decision-advice-panel.tsx` | 新增。只读决策面板：列表 + 详情 + 独立评估反馈；每个影子表面都带「仅用于评估，不改变审计结论」声明。 |
| `apps/web/src/routes/decision-advice.tsx` | 新增。按案件读取建议列表与详情；反馈幂等键按操作生成、失败时保留以复用。 |
| `apps/web/src/components/app-shell.tsx` | 2026-10-17按用户要求移除登录与会话查询，直接加载导航、业务页面和健康状态；保留辅助决策导航与面包屑。 |
| `apps/web/src/components/audit-case-workbench.tsx` | 案件头新增「辅助决策」入口；≤767px 三栏切换器。 |
| `apps/web/src/api.ts` | 新增决策列表/详情/反馈三个客户端函数，使用冻结的 `@contract-audit/audit/decision` DTO；错误按 `DecisionApiError` 版本化契约解码（404/409 可区分）。 |
| `apps/web/src/app.tsx` | 注册 `/audit-cases/$id/decisions` 路由。 |
| `apps/web/src/audit-presentation.ts` | 新增 `describeRunError`。 |
| `apps/web/src/routes/audit-trace.tsx` | 失败运行使用中文说明。 |
| `apps/web/src/styles.css` | 移动端三栏切换与决策面板；2026-10-17删除口令页样式。 |

## 4. 影子建议的呈现不变量

以下每条都在 `apps/web/src/components/decision-advice-panel.test.tsx` 中有对应行为测试（使用明确标注为 Fake 的 S1 合约样例，不调用任何提供方）：

1. **永不伪装成正式结论**：面板固定展示「影子建议仅用于评估，不改变审计结论」，并说明不能确认风险、判定误报或替代人工复核。
2. **置信不是准确率**：`confidenceType` 决定文案——`laya_entropy_concentration` 显示「Laya 熵集中度」、`answer_confidence` 显示「答案自评分」、`none` 不显示数值；`uncalibrated` 一律标注「未经校准」并说明不能作为准确率。
3. **缺失保持缺失**：`latencyMs: null` 显示「未记录」，`confidence: null`、`rawProbabilities: null` 不填充 0% 或零分布。
4. **阈值只在已校准且有时才出现**：`describeDecisionConfidence` 仅在 `calibrated && uncertainty === "calibrated"` 时展示阈值与策略版本。
5. **状态可区分**：`PENDING`/`RUNNING` 明确「仍在执行，尚未产生答案」且不显示反馈控件；`FAILED`/`SKIPPED` 展示失败原因；`off` 与「已开启但无记录」是两套不同文案。
6. **反馈独立**：反馈只提交到 `/api/decisions/:decisionId/feedback`，不接触 findings/reviews 路由；界面明示不影响审计结论、风险发现或人工复核记录。
7. **幂等**：一次操作生成一个 `Idempotency-Key`，网络重试复用同一键；请求失败不清除键，避免重复追加；下一次操作生成新键。
8. **来源可读**：提供方显示为「离线演示（Fake）」/「本地 Laya CPU」+ 模型版本，Fake 不被表述为实时模型记录。

## 5. 直接进入工作台

2026-10-17用户要求移除登录口令，将认证留到项目后期。当前壳层直接渲染业务页面，不查询会话、不显示登录或退出控件。原会话方案及历史截图不能作为当前能力说明。

`X-Operator`继续只记录操作归属。请求来源检查、脱敏日志、密钥加密及模型出网约束保留；身份认证、RBAC、SSO均不属于当前能力。

## 6. 需要 Main 执行的浏览器验证

以下为建议场景与判定标准。本文未运行这些检查；运行结果由 Main 记录。

### 6.1 无需登录的业务入口

| # | 场景 | 步骤 | 判定 |
| --- | --- | --- | --- |
| S1 | 新会话直达 | 全新浏览器打开 `/audit-cases` | 直接显示导航和真实审计队列，可新建案件；没有登录中间页 |
| S2 | API直接读取 | 无Cookie或Authorization请求案件列表 | 返回真实案件列表，不要求登录 |
| S3 | 刷新与深链接 | 刷新驾驶舱、案件详情及轨迹页 | 页面直接加载；不请求已移除的会话接口 |

### 6.2 影子建议界面

| # | 场景 | 前置 | 判定 |
| --- | --- | --- | --- |
| D1 | 关闭态 | `DECISION_MODE=off` | 面板显示「影子模式未开启，暂无辅助建议。」，不出现伪造条目 |
| D2 | 空态 | `DECISION_MODE=shadow`、无记录 | 显示「该案件暂无影子建议记录。」，与 D1 文案不同 |
| D3 | 成功建议 | shadow + Fake/Laya 产出 | 列表出现条目；详情显示来源、模型版本、答案、置信标签、证据锚点 |
| D4 | 失败建议 | 提供方超时/不可用 | 详情显示状态「失败」与中文失败原因；无答案区不显示伪造答案 |
| D5 | 反馈 | 对一条终态建议提交 | 201，详情反馈列表新增一条；actor 为当前操作人 |
| D6 | 反馈幂等 | 同一键同体重放 | 返回已存事件，不重复追加 |
| D7 | 反馈冲突 | 同一键不同 body | 409 |
| D8 | 未知决策 | `GET /api/decisions/<未知 UUID>` | 404 `decision_not_found` |
| D9 | 界面不越权 | 任一影子页面 | 不存在确认风险/判定误报/修改正式结论的按钮 |

### 6.3 工作流与尺寸

| # | 场景 | 判定 |
| --- | --- | --- |
| W1 | 上传→证据→复核→整改（1440×900） | 全流程可走通；确认风险后整改看板出现对应整改项 |
| W2 | 375px 复核 | 切换器可切到「风险发现」与「依据与复核」；确认风险/判定误报可见可点；无横向溢出 |
| W3 | 1280 / 1440 / 1920 | 三栏同时可见；切换器隐藏；无横向溢出 |
| W4 | 键盘可达 | Tab 可到达切换器各栏、发现项、复核按钮；Enter/Space 可激活发现项 |
| W5 | 截图 | 按 §7 取图 |

### 6.4 加载指标测量方案（不预设数值）

对同一 fixture 数据，在相同浏览器与网络条件下分别测量：

1. **审计队列首屏**：`page.goto("/audit-cases")` 到表格行可见的耗时；记录 `DOMContentLoaded` 与表格首行可见两个时刻。
2. **案件工作区**：进入 `/audit-cases/:id` 到 `.finding-list` 首项可见的耗时。
3. **决策面板**：进入 `/audit-cases/:id/decisions` 到面板标题可见、以及详情可读的耗时。
4. **重复测量**：每条测 5 次取中位数，冷/热缓存各一轮；记录浏览器版本、视口、是否首次编译路由。

测量方式建议用 Playwright 的 `performance.now()` 于页面内打点，或 `page.waitForSelector` 前后取 `Date.now()`；两种方式都应在报告中说明。**不得**用一次测量结果宣称提升比例；前后对比必须在相同 fixture、相同路由编译状态下进行。

## 7. 截图方案

| 图 | 视口 | 内容 |
| --- | --- | --- |
| before/after-375-review.png | 375×812 | 修复前：仅合同原文、无风险列表与复核操作（依据：S1 缺陷复现）；修复后：切换器 + 选中栏 |
| desktop-1280/1440/1920-workbench.png | 对应宽度 | 三栏审查工作区全貌 |
| decision-off.png / decision-empty.png | 1440×900 | 关闭态与空态两种可区分文案 |
| decision-detail.png | 1440×900 | 成功建议详情：来源、答案、置信与校准、证据 |
| decision-feedback.png | 1440×900 | 反馈提交后的反馈列表 |
| review-remediation.png | 1440×900 | 复核中心与整改看板 |

截图命名与存放目录由 Main 在集成时统一（建议 `docs/ux/screenshots/`）。本文不声称已生成这些截图。

## 8. 未修改项与理由

- **Ant Design 6 / React 19 体系保持不变**（F2）。改造只复用现有 `Layout`/`Menu`/`Table`/`Drawer`/`Alert`/`Tag`/`Segmented` 与 CSS 变量，未引入新组件库或迁移框架。
- **既有验收规格未改**（`tests/acceptance/*.spec.ts` 中除本次新增两个文件外的内容）。既有用例由 QA 与 Main 维护，避免跨 Agent 冲突。
- **后端路由、DTO、schema由对应实现负责人维护**。决策客户端继续使用冻结的领域类型；2026-10-17认证延期，当前不存在口令或会话接口。
- **未新增环境变量**。登录口令变量已从当前配置模板及演示工具移除。

## 9. 已知限制

1. 影子建议界面依赖服务端决策路由；路由未就绪时面板会显示「无法加载辅助建议」与可重试按钮，不展示任何占位建议。
2. 375px 下三栏为单栏切换而非同屏；这是宽度约束下的选择，完整三栏体验面向桌面。
3. 反馈理由上限 500 字符，actor 取当前操作人偏好；服务端的 actor 校验（空值、128 字符上限）以服务端为准。
4. 本文的所有浏览器结论均为「待 Main 验证」；已实际运行的只有 Bun 单元/组件测试（见 §10）。

## 10. 已实际运行的检查

- `bun test apps/web`：79 通过 / 0 失败（含本次新增 8 条决策面板行为测试）。
- `bunx tsc --noEmit -p apps/web/tsconfig.json`：通过。
- 两个新增 Playwright 规格已编写并单独通过 TypeScript 检查，但**未运行**（需要迁移数据库与浏览器，属 Main 集成后验证）。
