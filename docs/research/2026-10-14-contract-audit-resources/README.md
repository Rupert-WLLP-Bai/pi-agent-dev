# 合同审查资源筛选与本地样本

调研日期：2026-10-14。来源为[财务法务AI实战手册](https://www.jxxy.net/ai/paths/finance-ai-playbook/)及[合同审核分类页](https://www.jxxy.net/ai/categories/ai-finance-legal/contract-review/)。分类页的[第二页](https://www.jxxy.net/ai/categories/ai-finance-legal/contract-review/2/)也已读取：共24篇，第二页4篇主要是飞书合同生成、打印与到期续约流程。

结论：最值得改编的 skill 是 Anthropic 官方 legal 插件；最贴合现有证据模型的 RAG 工程参考是 Alder。真正支持中文合同审计结论的知识资料，应来自官方法规、司法解释、适用的示范文本及企业已批准的制度。介绍开源项目的文章、提示词、生成的修改建议和模型权重均不能替代这些依据。

本目录保存研究资料和上游文本快照。运行时没有安装插件、启用这些 skill 或导入这些资料。上游文本按 UTF-8 保存，末尾换行规范化；本地文件摘要与原始链接记录在各 manifest 中。

## 与当前实现的关系

- [runtime.ts](../../../packages/pi-agent/src/runtime.ts)明确加载一个 `payment-terms-audit.skill.md`，并设置 `noSkills: true`；把其他 `SKILL.md` 放进仓库不会自动改变审计行为。
- [tools.ts](../../../packages/pi-agent/src/tools.ts)提供六个工具：规则评估、证据读取、合同全文、合同内搜索、块读取和 finding 提交。合同内关键词搜索不等于外部知识库 RAG。
- [proposal-guard.ts](../../../packages/audit/src/proposal-guard.ts)控制 finding 类型和严重度；外部 skill 的红黄绿评级、通用市场标准和默认数值不能覆盖确定性评估。
- [model.ts](../../../packages/audit/src/model.ts)要求 Evidence 有 Source Record 与 locator；[CONTEXT.md](../../../CONTEXT.md)要求 Snapshot 不可变，模型解释与信心不是 Evidence。
- 本轮用真实 `createAuditSnapshot` 和 `createAuditTools` 对合成 golden 合同执行了规则读取与正文读取：返回六个预期工具、17个评估、5个证据 locator，70%预付款维度为 `POLICY_CONFLICT`。这证明当前工具边界可运行，没有调用外部模型或业务数据库。

## 可改编为 skill 的资源

| 资源 | 用在项目中的价值 | 适配边界 | 处理 |
| --- | --- | --- | --- |
| [Anthropic review-contract](https://github.com/anthropics/knowledge-work-plugins/tree/02ffa99ff00ce4d3046ccebabb8357cb39f3ab06/legal/skills/review-contract) | 按本方角色与 playbook 逐条审查；交叉看责任上限、赔偿、知识产权、数据处理、续约；建议文本带修改理由与退让方案 | 默认 playbook 以美国法域为基准；通用市场标准不能作为中国法律或企业政策；保留当前 assessment 与证据约束 | 优先改编；已保存原文 |
| [Anthropic triage-nda](https://github.com/anthropics/knowledge-work-plugins/tree/02ffa99ff00ce4d3046ccebabb8357cb39f3ab06/legal/skills/triage-nda) | NDA 的定义、使用目的、允许披露、返还销毁、残留记忆条款与隐藏限制检查 | 原文 GREEN 路由包含标准授权签署建议，不能变成本项目的自动审批；2–5年等期限是默认商业立场，非中国法律上限 | NDA 场景候选；已保存原文 |
| [Anthropic compliance-check](https://github.com/anthropics/knowledge-work-plugins/tree/02ffa99ff00ce4d3046ccebabb8357cb39f3ab06/legal/skills/compliance-check) | 数据处理协议、分包处理方、数据返还、跨境与安全义务的检查框架，适合ICT服务合同 | 主要细则来自 GDPR/CCPA，PIPL 仅简要列举；需结合实际法域及中国现行规定，不照搬72小时等数值 | 数据条款场景候选；已保存原文 |
| [合同条款风险审查提示词](https://www.jxxy.net/ai/prompts/agent/prompt-finance-contract-risk-review/) | 八维检查清单、原文位置、具体修改话术 | 无法条和企业规则版本；“能不能签”的总结不能替代 Human Review | 仅方法参考 |
| [合同关键信息提取对比提示词](https://www.jxxy.net/ai/prompts/agent/prompt-finance-contract-extraction/) | 金额、币种、账期、期限与续约等字段清单；原文未约定时不编造 | 模型提取需校验和 locator，不能直接作为确定性 Fact；台账与提醒是额外产品能力 | 方法参考，字段价值较高 |
| [NDA Analyzer](https://github.com/ismaeldosil/nda-analyzer) | 先引用原文再评价、缺失标 NOT PRESENT、视角与严格度参数化 | Delaware 优化、并购买方视角；README 声明 MIT，但本轮未取得独立 LICENSE 文件；不采其判例与条款基准作中国知识 | 只借审查方法 |
| [Claude 合同审查五步法](https://www.jxxy.net/ai/articles/claude-contract-review-five-step-workflow/) | 定向简报；分别检查存在、异常、歧义、缺失；待核项关闭后交付 | 视频教程的翻译重组，无已核许可证的原始 skill 文件 | 方法参考 |
| [合同与提案撰写上游 skill](https://github.com/alirezarezvani/claude-skills/blob/main/business-growth/contract-and-proposal-writer/SKILL.md) | SOW、验收、范围变更、既有IP与交付物的检查维度 | 页面原文覆盖 US/EU/UK/DACH，主要任务是生成合同；不作为当前审计 agent 的主 skill | 暂不采入 |

前三项上游 `legal/LICENSE` 已核为 Apache-2.0。实际目录名是 `review-contract` 和 `triage-nda`，不能把 README 展示名 `contract-review`、`nda-triage` 当作文件路径。

[觉醒AI用户协议](https://www.jxxy.net/ai/terms/)允许个人学习浏览、下载和打印，但限制未经书面许可的商业复制、转载和二次创作，并禁止大量自动抓取。其 [llms.txt](https://www.jxxy.net/ai/llms.txt) 的 AI 引用声明不等于产品转载授权。本轮没有保存该站原创提示词全文到产品，也没有联系站方。已保存的 skill 来自许可证明确的 GitHub 上游。

## RAG 工程参考与数据集

| 原始来源 | 可借鉴之处 | 用途与限制 |
| --- | --- | --- |
| [Alder](https://github.com/alpastorvillar-design/alder-document-intelligence) | 类型化证据定位器、版本化确定性规则、人工批准；混合检索按卷宗和 embedding 配置隔离；生成答案只可引用检索集里的 id | MIT；最高优先级工程参考。领域为西班牙创新补贴，原始样本为合成资料；没有中文法规库。已拉取三份ADR与许可证 |
| [ClauseGuard](https://github.com/naresh25peta-cell/clauseguard) | 字段级提示词契约、条款风险矩阵与离线 API 客户端边界 | MIT；LNG货物提名及英文MSA。LLM语义分数只能作未决维度研究，不替代本项目确定性规则 |
| [Semantica](https://github.com/semantica-agi/semantica) | 来源追溯、冲突记录、知识图谱与决策链表达 | MIT；通用引擎，没有中文合同知识资料。当前快照与证据链已有相近职责，是否引入图存储需由实际查询需求决定 |
| [agentic-file-query](https://github.com/sabit-shaikholla/agentic-file-query) | 扫描、深挖、回溯；直接读文件与向量检索结合 | Google ADK/Gemini，与Pi/TS栈不同；README称MIT，但本轮未取得独立 LICENSE 文件。任意文件夹检索需要重新约束资料边界 |
| [DOCANA](https://github.com/ArtStyle19/sistema-de-analisis-de-documentos-juridicos) | 法律文书元数据、pgvector检索、BERTopic聚类、本地Ollama | 秘鲁/西语领域；README称MIT，但本轮未取得独立 LICENSE 文件。需另行准备中文资料和检索评测 |
| [ContractIQ](https://github.com/Manoj-dj/ContractIQ) | 条款抽取的页码/字符区间、缺失关键条款提示 | 英文CUAD场景；本轮未找到 LICENSE；模型权重为Git LFS。README的F1是项目自报，不能推成中文审计效果 |
| [CUAD](https://www.atticusprojectai.org/cuad/) | 41类条款的分类定义；英文抽取和引用定位的训练/评测参照 | 官方声明 CC BY 4.0；510份英文合同，主要来自SEC EDGAR。可做分类与研究参考，不能当中国法规或中文审计标注答案 |

上述六个工程项目均不提供本项目需要的中文权威法规库。CUAD 的[原始论文](https://arxiv.org/abs/2103.06268)定义的是合同条款抽取任务；模型分数应按数据划分和指标口径分别解读。

Alder 已拉取的工程文档：

- [证据定位器ADR](references/alder/docs/adr/0001-evidence-locators.md)
- [确定性规则ADR](references/alder/docs/adr/0003-deterministic-rules-not-a-model.md)
- [混合检索与只读RAG ADR](references/alder/docs/adr/0006-hybrid-retrieval-and-opt-in-rag.md)
- [MIT许可](references/alder/LICENSE)及[来源清单](reference-manifest.json)

## 已拉取 skill 样本

上游版本：`anthropics/knowledge-work-plugins@02ffa99ff00ce4d3046ccebabb8357cb39f3ab06`。保留上游目录关系，使 skill 的 `../../CONNECTORS.md` 指针可以解析。该部分是选取文件的研究快照，不是完整插件发行包。

- [合同审查skill原文](skills/anthropic-legal/legal/skills/review-contract/SKILL.md)
- [NDA分诊skill原文](skills/anthropic-legal/legal/skills/triage-nda/SKILL.md)
- [合规检查skill原文](skills/anthropic-legal/legal/skills/compliance-check/SKILL.md)
- [上游README及美国法域声明](skills/anthropic-legal/legal/README.md)
- [连接器说明](skills/anthropic-legal/legal/CONNECTORS.md)
- [Apache-2.0许可](skills/anthropic-legal/legal/LICENSE)及[来源清单](skill-manifest.json)

## 已拉取中文知识样本

新增 subagent 完成6轮不同方向的web_search，并核对官方发布正文与下载附件；[查询记录和候选池](chinese-knowledge-research.md)保存全部轮次与原始来源。最终保留6个知识文件，来自5项官方资料。

| 本地样本 | 官方来源 | 对项目的用途与边界 |
| --- | --- | --- |
| [2025款项支付条例正文](knowledge/sme-payment-regulation-2025-fulltext.md) | [生态环境部转发中国政府网](https://www.mee.gov.cn/zcwj/gwywj/202503/t20250325_1104643.shtml) | 付款条件、期限起算、验收拖延、非现金支付和逾期利息；5章37条，2025-06-01施行；只在其主体和场景条件成立时引用 |
| [背靠背付款批复全文](knowledge/spc-2024-11-back-to-back-reply-fulltext.md) | [最高人民法院](https://www.court.gov.cn/zixun/xiangqing/441281.html) | 法释〔2024〕11号，公告与两条批复；大型企业与中小企业交易的付款前提及其无效后果，不能推广到所有主体 |
| [民法典52条摘录](knowledge/civil-code-contract-excerpt.md) | [云南省司法厅转载新华社受权发布正文](https://sft.yn.gov.cn/pf/yunnan/PZhengCeFaGui/2020061631_2.shtml) | 违约责任、定金、保证、技术成果权属与技术服务；每个选中条文保留全部款项，非民法典全文；条文已逐条与官方分页比对 |
| [技术开发委托合同Word原件](knowledge/tech-dev-entrust-template.doc) | [上海市技术市场管理办公室模板下载](https://stcsm.sh.gov.cn/jsscgl/mbxz/20200108/0016-153850.html) | 委托开发的交付、验收、保密、技术风险、专利及技术秘密权属检查参照；完整原件保留，未提供可靠文本抽取版；示范条款不是法定必备格式 |
| [数据提供合同PDF原件](knowledge/data-provision-contract-GF-2025-2615.pdf)及[抽取文本](knowledge/data-provision-contract-GF-2025-2615-extracted.txt) | [国家数据局、市场监管总局发布通知](https://www.nda.gov.cn/sjj/zwgk/zcfb/0704/20250704153908883080116_pc.html) | GF-2025-2615，20页含封面；数据来源与权利、API交付、质量验收、安全和终止后处置检查参照；推荐性范本，非强制规范 |

[知识资料清单](knowledge-manifest.json)记录来源、版本、生效日期、适用范围、完整/摘录状态和本地SHA-256。民法典初次抽取遗漏的后续款已补齐；技术开发Word的UTF-16扫描派生文本漏字段，已删除，原件完整保留。

应用条例第九条时须区分：机关/事业单位30日默认且另约最长60日；大型企业60日是默认期限，另有约定须按行业规范和交易习惯合理确定。不能把所有超过60日的合同自动判成违法。民法典第586条定金20%上限也不能作为一般预付款比例上限。

新增中文候选中，[chinalaw-cli](https://github.com/nh59yytyd5-dev/chinalaw-cli)的条文级来源与缺失报错机制可作检索层参考，但代码许可与法规数据包权利说明需分别核对；[contract-copilot.skill](https://github.com/cat-xierluo/contract-copilot.skill)为CC BY-NC 4.0，适合方法研究，产品复用有非商用限制。本轮均未安装或下载它们的数据包。


## 知识资料接入的建议

1. 优先形成中国法规/司法解释、企业已批准制度、已审核示范条款三类资料；示范合同和案例分别标注其用途，不把模板偏离直接判成违法。
2. 保存来源URL、发布机关、文号、版本、生效时间、适用法域、适用主体、完整/摘录边界及内容摘要。检索时先按审计日期、合同场景、主体条件和访问权限筛选。
3. 将本次引用到的资料版本和有界位置冻结进 Audit Snapshot，再供agent使用。网页标题、搜索摘要或模型记忆都不足以成为可提交的 evidenceIds。
4. skill 负责审查步骤和引用纪律；企业 playbook 的 preferred/acceptableRetreat/unacceptable 对应现有 Negotiation Stance；规则阈值仍由已发布规则版本提供。
5. 新审查维度需同步规则契约、proposal guard、工具schema与验证案例。仅增加提示词不会授权当前工具提交一个未知 findingType。

目前只推荐资料与适配方向；这些来源的检索质量、中文适配效果与任何提效指标尚未实测。

## 本轮对既有笔记的补充

既有[财务手册调研](../2026-10-14-finance-ai-materials.md)记录两页正文未核到。本轮改用原始HTML并提取文章正文，已核到：

- [法律合同审查与诉讼策略提示词](https://www.jxxy.net/ai/prompts/agent/prompt-legal-contract-litigation/)确实要求案号、类案胜诉率和预期胜诉概率，并给出未附可核出处的示例数字；因此仍不采为知识依据。
- [合同与提案撰写提示词](https://www.jxxy.net/ai/prompts/agent/prompt-arcs-contract-and-proposal-writer/)实际指向 `alirezarezvani/claude-skills`，覆盖 US/EU/UK/DACH，主要是合同生成。正文可读取，但场景和法域限制未改变。

既有笔记保留原调研记录，本文件记录此次新取得的事实。

## 交付验证

- 三份manifest覆盖16个来源文件：Anthropic的3份skill与3份配套文件、Alder的3份ADR与许可证、6份中文知识文件。所有本地SHA-256均按实际文件重新计算并与清单匹配。
- 52条民法典摘录逐条对比官方分页，全部款项一致（仅规范空白）；条例包含第一条至第三十七条；PDF抽取版包含GF-2025-2615标识与第十六条。
- `pdfinfo`确认数据提供合同20页含封面；PDF可读取，未加密。Word原件格式已识别为WPS保存的复合文档；未通过可靠文本抽取，只有原件作为候选资料。
- `bunx biome check`对本次三份manifest通过：Checked 3 files，No fixes applied。
- `bun run verify`已执行，但在lint阶段报告22个错误和1个警告，涉及本轮未修改的dispatcher、OCR设置/解析、health、LLM和web文件；后续typecheck与测试未被该链条执行。本轮未修改这些应用文件。
- 现有审计工具的运行验证见前文；没有运行候选skill、启用RAG或测量中文检索效果。临时文档解析器文件已清除。

