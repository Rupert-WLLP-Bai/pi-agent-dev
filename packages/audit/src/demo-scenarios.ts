import type { FindingType, RemediationStatus, ReviewDecision } from "./model";

export const OUR_PARTY = "重庆华盛贸易有限公司";

export const FILLER_COUNTERPARTIES = [
  "深圳精工科技有限公司",
  "昆明矿业发展有限公司",
  "东莞芯创电子有限公司",
  "苏州远航机械有限公司",
  "武汉光谷软件有限公司",
  "青岛海川贸易有限公司",
  "西安西部材料有限公司",
  "长沙湘能电力有限公司",
  "合肥智造装备有限公司",
  "南京云启信息有限公司",
  "天津滨海物流有限公司",
  "福州海峡建设有限公司",
  "郑州中原机电有限公司",
] as const;

const FILLER_TEMPLATES = [
  {
    label: "设备租赁",
    title: "叉车租赁合同",
    roleA: "承租方",
    roleB: "出租方",
    subject: "乙方向甲方出租内燃叉车三台，租期十二个月，含日常维保。",
  },
  {
    label: "办公采购",
    title: "办公设备采购合同",
    roleA: "采购方",
    roleB: "供货方",
    subject: "乙方向甲方供应台式电脑、显示器与打印机等办公设备一批。",
  },
  {
    label: "维保服务",
    title: "电梯维保服务合同",
    roleA: "委托方",
    roleB: "维保方",
    subject: "乙方负责甲方厂区四部电梯的季度巡检与故障抢修。",
  },
  {
    label: "咨询服务",
    title: "管理咨询服务合同",
    roleA: "委托方",
    roleB: "受托方",
    subject: "乙方为甲方提供供应链流程诊断与改善方案。",
  },
  {
    label: "物流运输",
    title: "城际物流运输合同",
    roleA: "托运方",
    roleB: "承运方",
    subject: "乙方承运甲方产成品由重庆至华东各仓的公路运输。",
  },
  {
    label: "软件开发",
    title: "业务系统开发合同",
    roleA: "委托方",
    roleB: "开发方",
    subject: "乙方为甲方开发仓储管理子系统并完成联调上线。",
  },
  {
    label: "技术许可",
    title: "工艺技术许可合同",
    roleA: "被许可方",
    roleB: "许可方",
    subject: "乙方向甲方许可一项表面处理工艺的非独占使用权。",
  },
  {
    label: "原料供应",
    title: "钢材年度供应合同",
    roleA: "采购方",
    roleB: "供货方",
    subject: "乙方向甲方按月供应约定规格的热轧钢板。",
  },
  {
    label: "广告投放",
    title: "品牌广告投放合同",
    roleA: "广告主",
    roleB: "代理方",
    subject: "乙方为甲方策划并投放第四季度区域品牌广告。",
  },
  {
    label: "工程施工",
    title: "厂区改造施工合同",
    roleA: "发包方",
    roleB: "承包方",
    subject: "乙方承接甲方厂房屋面防水与局部钢结构加固工程。",
  },
] as const;

const FILLER_AMOUNTS = [
  { amountChinese: "叁拾万元整", amountNumber: "300,000.00" },
  { amountChinese: "伍拾万元整", amountNumber: "500,000.00" },
  { amountChinese: "捌拾万元整", amountNumber: "800,000.00" },
  { amountChinese: "壹佰贰拾万元整", amountNumber: "1,200,000.00" },
  { amountChinese: "贰佰万元整", amountNumber: "2,000,000.00" },
  { amountChinese: "叁佰伍拾万元整", amountNumber: "3,500,000.00" },
] as const;

export interface ContractDraft {
  title: string;
  partyB: string;
  roleA?: string;
  roleB?: string;
  subject: string;
  amountChinese: string;
  amountNumber: string;
  advancePercent: number;
  penaltyPercent: number;
  jurisdiction: string;
  includeTermination: boolean;
  extraClauses?: string[];
  signedAt: string;
}

export interface ScenarioReview {
  findingType: FindingType;
  decision: ReviewDecision;
  reviewerId: string;
  reason?: string;
}

export interface ScenarioCase {
  /** Stable id stored on the source record, used to reset and to drive the gallery. */
  id: string;
  /** Gallery grouping; several cases can share one story. */
  scenarioId: string;
  title: string;
  summary: string;
  verifies: string;
  createdAt: string;
  assignee?: string;
  text: string;
  reviews?: ScenarioReview[];
  /** After reviews, walk the opened remediation to this status. */
  remediationStatus?: RemediationStatus;
  remediationOwner?: string;
  remediationCloser?: string;
  /** Cases sharing a lineage become revisions of one Contract when seeded. */
  contractLineage?: string;
}

export interface DemoScenario {
  id: string;
  title: string;
  story: string;
  verifies: string;
  featured?: boolean;
  caseIds: string[];
}

/** Builds a contract the fact extractor can read: Arabic % first appears in 第三条. */
export function buildContractText(draft: ContractDraft): string {
  const roleA = draft.roleA ?? "委托方";
  const roleB = draft.roleB ?? "受托方";
  const termination = draft.includeTermination
    ? `第七条 合同终止
任一方严重违约且经书面催告后十五日内未纠正的，守约方有权终止本合同。`
    : `第七条 通知与送达
双方往来文件以本合同载明的地址为准。`;
  const extras = (draft.extraClauses ?? []).join("\n\n");
  return `${draft.title}

甲方：${OUR_PARTY}（${roleA}）
乙方：${draft.partyB}（${roleB}）

第一条 合同标的
${draft.subject}

第二条 合同价款
合同总价为人民币${draft.amountChinese}（小写：${draft.amountNumber}元），含增值税。

第三条 支付方式
甲方应在合同签订后5日内支付合同总价${draft.advancePercent}%作为预付款，其余按验收节点结算。

第四条 交付与验收
乙方应按约定节点交付并提交验收资料。

第五条 违约责任
任何一方违反本合同约定，应向守约方支付合同总价${draft.penaltyPercent}%的违约金。

第六条 赔偿责任
因乙方原因造成甲方损失的，乙方赔偿金额以合同金额为限，不承担间接损失。

${termination}

第八条 争议解决
因本合同引起的争议，双方应友好协商解决；协商不成的，向${draft.jurisdiction}人民法院提起诉讼。
${extras === "" ? "" : `\n${extras}\n`}
签订日期：${draft.signedAt}`;
}

const clean = (
  overrides: Partial<ContractDraft> & Pick<ContractDraft, "title" | "partyB" | "signedAt">,
) =>
  buildContractText({
    subject: "乙方向甲方提供约定范围内的货物或服务。",
    amountChinese: "伍拾万元整",
    amountNumber: "500,000.00",
    advancePercent: 20,
    penaltyPercent: 5,
    jurisdiction: "重庆",
    includeTermination: true,
    ...overrides,
  });

export const demoScenarioCases: ScenarioCase[] = [
  {
    id: "history-old-advance",
    scenarioId: "cross-case-missed-link",
    title: "重型设备租赁合同（历史预付款超限）",
    summary: "三个月前法务张三已确认该相对方预付款 50% 超限，并完成整改。",
    verifies: "历史案件闭环：确认风险 → 整改关闭",
    createdAt: "2026-06-14T08:00:00.000Z",
    assignee: "张三",
    text: clean({
      title: "重型设备租赁合同",
      partyB: "成都建工集团有限公司",
      roleA: "承租方",
      roleB: "出租方",
      subject: "乙方向甲方出租塔式起重机两台与施工电梯一台，租赁期为十二个月。",
      amountChinese: "壹佰伍拾万元整",
      amountNumber: "1,500,000.00",
      advancePercent: 50,
      signedAt: "2026年6月10日",
    }),
    reviews: [
      {
        findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
        decision: "ACCEPTED",
        reviewerId: "张三",
        reason: "预付款远超制度上限，已要求对方改条款。",
      },
    ],
    remediationStatus: "closed",
    remediationOwner: "张工",
    remediationCloser: "张三",
  },
  {
    id: "history-new-clean-look",
    scenarioId: "cross-case-missed-link",
    title: "劳务分包合同（条款看似合规）",
    summary: "法务李四待审。合同条款本身达标，但相对方三个月前刚被确认过预付款风险。",
    verifies: "跨案漏关联：不同复核人看不到历史，系统应自动识别",
    createdAt: "2026-09-12T09:30:00.000Z",
    assignee: "李四",
    text: clean({
      title: "劳务分包合同",
      partyB: "成都建工集团有限公司",
      roleA: "发包方",
      roleB: "承包方",
      subject: "乙方为甲方厂区设备安装提供劳务作业，工期六个月。",
      amountChinese: "捌拾万元整",
      amountNumber: "800,000.00",
      advancePercent: 20,
      signedAt: "2026年9月10日",
    }),
  },
  {
    id: "equipment-lease-v1",
    scenarioId: "contract-version-diff",
    contractLineage: "equipment-lease",
    title: "设备采购合同（初版）",
    summary: "预付款 70% 触发制度冲突，作为合同 v1 入库。",
    verifies: "Contract Revision：v1 风险基线",
    createdAt: "2026-08-01T10:00:00.000Z",
    assignee: "王五",
    text: clean({
      title: "设备采购合同",
      partyB: "深圳精工科技有限公司",
      advancePercent: 70,
      signedAt: "2026年7月28日",
    }),
  },
  {
    id: "equipment-lease-v2",
    scenarioId: "contract-version-diff",
    contractLineage: "equipment-lease",
    title: "设备采购合同（修订版）",
    summary: "预付款降至 20%，作为同一 Contract 的 v2 再审计。",
    verifies: "版本 diff：预付款风险应显示为已消除",
    createdAt: "2026-09-01T10:00:00.000Z",
    assignee: "赵六",
    text: clean({
      title: "设备采购合同",
      partyB: "深圳精工科技有限公司",
      advancePercent: 20,
      signedAt: "2026年8月30日",
    }),
  },
  {
    id: "subject-red-line",
    scenarioId: "subject-red-line",
    title: "工程服务合同（乙方主体红线）",
    summary: "条款合规，但乙方为失信被执行人。",
    verifies: "主体核验独立于条款审查",
    createdAt: "2026-09-08T10:00:00.000Z",
    assignee: "王芳",
    text: clean({
      title: "工程服务合同",
      partyB: "重庆恒昌建筑工程有限公司",
      roleA: "发包方",
      roleB: "承包方",
      subject: "乙方为甲方厂区提供设备安装与调试服务。",
      signedAt: "2026年9月6日",
    }),
  },
  {
    id: "clean-pass",
    scenarioId: "clean-pass",
    title: "管理咨询合同（全合规通过）",
    summary: "预付款、违约金、终止与管辖均合规，主体无红线，应直接完成。",
    verifies: "通过案件：无 finding 即 COMPLETED",
    createdAt: "2026-09-05T07:00:00.000Z",
    text: clean({
      title: "管理咨询合同",
      partyB: "宁波安达物流有限公司",
      roleA: "委托方",
      roleB: "咨询方",
      subject: "乙方为甲方提供为期六个月的生产线优化咨询服务。",
      amountChinese: "叁拾万元整",
      amountNumber: "300,000.00",
      signedAt: "2026年9月5日",
    }),
  },
  {
    id: "multi-conflict",
    scenarioId: "multi-conflict",
    title: "设备采购合同（预付款 + 异地管辖）",
    summary: "预付款 50% 且争议管辖在成都，待复核。",
    verifies: "多维政策冲突同时出现",
    createdAt: "2026-09-11T11:00:00.000Z",
    assignee: "赵强",
    text: clean({
      title: "设备采购合同",
      partyB: "昆明矿业发展有限公司",
      roleA: "买方",
      roleB: "卖方",
      subject: "乙方向甲方供应破碎设备一套。",
      advancePercent: 50,
      jurisdiction: "成都",
      signedAt: "2026年9月11日",
    }),
  },
  {
    id: "false-positive-old",
    scenarioId: "false-positive-contrast",
    title: "配件采购合同（历史同类发现被驳回）",
    summary: "法务王芳将预付款发现判定为误报。",
    verifies: "历史误报样本",
    createdAt: "2026-07-20T08:00:00.000Z",
    assignee: "王芳",
    text: clean({
      title: "配件采购合同",
      partyB: "杭州智联科技有限公司",
      roleA: "采购方",
      roleB: "供货方",
      subject: "乙方向甲方供应备品备件一批。",
      advancePercent: 35,
      signedAt: "2026年7月18日",
    }),
    reviews: [
      {
        findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
        decision: "REJECTED",
        reviewerId: "王芳",
        reason: "该笔预付款已有专项审批，不构成风险。",
      },
    ],
  },
  {
    id: "false-positive-new",
    scenarioId: "false-positive-contrast",
    title: "备件续购合同（同类条款再次出现）",
    summary: "同一相对方再次出现 35% 预付款，历史曾被驳回，应转人工对照。",
    verifies: "历史误报对照：关联后为需人工复核",
    createdAt: "2026-09-13T08:20:00.000Z",
    assignee: "李四",
    text: clean({
      title: "备件续购合同",
      partyB: "杭州智联科技有限公司",
      roleA: "采购方",
      roleB: "供货方",
      subject: "乙方向甲方续供同一型号备品备件。",
      advancePercent: 35,
      signedAt: "2026年9月12日",
    }),
  },
  {
    id: "back-to-back",
    scenarioId: "back-to-back",
    title: "施工分包合同（背靠背付款）",
    summary: "工程款以收到业主付款为前提。",
    verifies: "背靠背付款条款规则",
    createdAt: "2026-09-09T14:00:00.000Z",
    assignee: "赵强",
    text: `${buildContractText({
      title: "施工分包合同",
      partyB: "深圳精工科技有限公司",
      roleA: "发包方",
      roleB: "承包方",
      subject: "乙方承接甲方厂区管廊安装工程的分包施工。",
      amountChinese: "壹佰伍拾万元整",
      amountNumber: "1,500,000.00",
      advancePercent: 20,
      penaltyPercent: 5,
      jurisdiction: "重庆",
      includeTermination: true,
      extraClauses: [
        `第九条 进度款
甲方在收到业主方支付的相应工程款后15日内向乙方支付进度款。`,
      ],
      signedAt: "2026年9月9日",
    })}`,
  },
  {
    id: "missing-clause",
    scenarioId: "missing-clause",
    title: "物流服务合同（缺终止条款）",
    summary: "未约定解除或终止条款，应转人工复核。",
    verifies: "缺保护性条款 → NEEDS_HUMAN_REVIEW",
    createdAt: "2026-09-07T09:00:00.000Z",
    assignee: "王芳",
    text: clean({
      title: "物流服务合同",
      partyB: "昆明矿业发展有限公司",
      roleA: "托运方",
      roleB: "承运方",
      subject: "乙方为甲方提供仓储与城际配送服务，服务期一年。",
      includeTermination: false,
      signedAt: "2026年9月7日",
    }),
  },
  {
    id: "remediation-pending",
    scenarioId: "remediation-board",
    title: "广告服务合同（待整改）",
    summary: "管辖冲突已确认，整改项停在待整改。",
    verifies: "整改看板：待整改",
    createdAt: "2026-08-28T10:00:00.000Z",
    assignee: "张三",
    text: clean({
      title: "广告服务合同",
      partyB: "东莞芯创电子有限公司",
      jurisdiction: "成都",
      signedAt: "2026年8月26日",
    }),
    reviews: [
      {
        findingType: "DISPUTE_JURISDICTION_CONFLICT",
        decision: "ACCEPTED",
        reviewerId: "张三",
      },
    ],
    remediationStatus: "pending",
  },
  {
    id: "remediation-in-progress",
    scenarioId: "remediation-board",
    title: "维保服务合同（整改中）",
    summary: "管辖冲突已确认，整改进行中。",
    verifies: "整改看板：整改中",
    createdAt: "2026-08-21T10:00:00.000Z",
    assignee: "李四",
    text: clean({
      title: "维保服务合同",
      partyB: "深圳精工科技有限公司",
      jurisdiction: "成都",
      signedAt: "2026年8月20日",
    }),
    reviews: [
      {
        findingType: "DISPUTE_JURISDICTION_CONFLICT",
        decision: "ACCEPTED",
        reviewerId: "李四",
      },
    ],
    remediationStatus: "in_progress",
    remediationOwner: "张工",
  },
  {
    id: "remediation-awaiting",
    scenarioId: "remediation-board",
    title: "原料供应合同（待复核整改）",
    summary: "整改完成，等待另一复核人关闭。",
    verifies: "整改看板：待复核",
    createdAt: "2026-08-14T10:00:00.000Z",
    assignee: "王芳",
    text: clean({
      title: "原料供应合同",
      partyB: "昆明矿业发展有限公司",
      jurisdiction: "成都",
      signedAt: "2026年8月12日",
    }),
    reviews: [
      {
        findingType: "DISPUTE_JURISDICTION_CONFLICT",
        decision: "ACCEPTED",
        reviewerId: "王芳",
      },
    ],
    remediationStatus: "awaiting_review",
    remediationOwner: "张工",
  },
  {
    id: "remediation-closed",
    scenarioId: "remediation-board",
    title: "备件采购合同（整改已关闭）",
    summary: "整改已由另一复核人关闭。",
    verifies: "整改看板：已关闭",
    createdAt: "2026-08-02T10:00:00.000Z",
    assignee: "赵强",
    text: clean({
      title: "备件采购合同",
      partyB: "东莞芯创电子有限公司",
      jurisdiction: "成都",
      signedAt: "2026年8月1日",
    }),
    reviews: [
      {
        findingType: "DISPUTE_JURISDICTION_CONFLICT",
        decision: "ACCEPTED",
        reviewerId: "赵强",
      },
    ],
    remediationStatus: "closed",
    remediationOwner: "张工",
    remediationCloser: "李复核",
  },
];

export const demoScenarios: DemoScenario[] = [
  {
    id: "cross-case-missed-link",
    title: "跨案漏关联",
    story:
      "同一乙方「成都建工」三个月前被法务张三确认过预付款超限；本月法务李四审一份条款看似合规的新合同，系统应自动挂出历史风险。",
    verifies: "相对方历史关联规则",
    featured: true,
    caseIds: ["history-old-advance", "history-new-clean-look"],
  },
  {
    id: "contract-version-diff",
    title: "合同多版本对比",
    story: "同一设备采购合同先以 70% 预付款入库，修订为 20% 后再审；合同中心应展示版本 diff。",
    verifies: "Contract Revision + finding diff",
    featured: true,
    caseIds: ["equipment-lease-v1", "equipment-lease-v2"],
  },
  {
    id: "subject-red-line",
    title: "条款干净但主体红线",
    story: "合同文本全合规，乙方「重庆恒昌」为失信被执行人。",
    verifies: "主体核验",
    caseIds: ["subject-red-line"],
  },
  {
    id: "clean-pass",
    title: "全合规通过",
    story: "无 finding，案件直接完成。",
    verifies: "通过路径",
    caseIds: ["clean-pass"],
  },
  {
    id: "multi-conflict",
    title: "多维政策冲突",
    story: "预付款超限与异地管辖同时出现。",
    verifies: "多发现复核",
    caseIds: ["multi-conflict"],
  },
  {
    id: "false-positive-contrast",
    title: "历史误报对照",
    story: "杭州智联上次同类发现被驳回，本次相似条款应提示对照历史误报。",
    verifies: "历史误报 → 需人工复核",
    caseIds: ["false-positive-old", "false-positive-new"],
  },
  {
    id: "back-to-back",
    title: "背靠背分包",
    story: "付款以收到业主款项为前提。",
    verifies: "背靠背付款条款",
    caseIds: ["back-to-back"],
  },
  {
    id: "missing-clause",
    title: "缺保护性条款",
    story: "未约定终止条款。",
    verifies: "条款缺失转人工",
    caseIds: ["missing-clause"],
  },
  {
    id: "remediation-board",
    title: "整改四态",
    story: "四份已确认发现分别停在待整改、整改中、待复核、已关闭。",
    verifies: "整改跟踪看板",
    caseIds: [
      "remediation-pending",
      "remediation-in-progress",
      "remediation-awaiting",
      "remediation-closed",
    ],
  },
];

export const DEFAULT_FILLER_COUNT = 18;
export const DEFAULT_RNG_SEED = 20260914;

interface Rng {
  next(): number;
}

function mulberry32(seed: number): Rng {
  let t = seed >>> 0;
  return {
    next() {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng.next() * items.length)];
  if (item === undefined) throw new Error("empty pick");
  return item;
}

/**
 * Filler volume around the authored scenarios. About 60% clean / 25% single
 * issue / 15% compound, reproducible from `rngSeed`.
 */
export function generateFillerCases(rngSeed: number, count: number): ScenarioCase[] {
  const rng = mulberry32(rngSeed);
  const cleanCount = Math.round(count * 0.6);
  const singleCount = Math.round(count * 0.25);
  const kinds: Array<"clean" | "single" | "complex"> = [
    ...Array.from({ length: cleanCount }, () => "clean" as const),
    ...Array.from({ length: singleCount }, () => "single" as const),
    ...Array.from(
      { length: Math.max(0, count - cleanCount - singleCount) },
      () => "complex" as const,
    ),
  ];
  for (let index = kinds.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng.next() * (index + 1));
    const current = kinds[index];
    const other = kinds[swap];
    if (current === undefined || other === undefined) continue;
    kinds[index] = other;
    kinds[swap] = current;
  }
  const cases: ScenarioCase[] = [];
  for (let index = 0; index < count; index += 1) {
    const kind = kinds[index] ?? "clean";
    const partyB = pick(rng, FILLER_COUNTERPARTIES);
    const template = pick(rng, FILLER_TEMPLATES);
    const amount = pick(rng, FILLER_AMOUNTS);
    const day = 1 + Math.floor(rng.next() * 27);
    const month = 7 + Math.floor(rng.next() * 3);
    const signedAt = `2026年${month}月${day}日`;
    const createdAt = new Date(Date.UTC(2026, month - 1, day, 6, index % 60)).toISOString();
    const id = `filler-${index + 1}`;
    let advancePercent = 20;
    let jurisdiction = "重庆";
    let includeTermination = true;
    let penaltyPercent = 5;
    if (kind === "single") {
      const axis = pick(rng, ["advance", "jurisdiction", "termination", "penalty"] as const);
      if (axis === "advance") advancePercent = 40;
      if (axis === "jurisdiction") jurisdiction = "成都";
      if (axis === "termination") includeTermination = false;
      if (axis === "penalty") penaltyPercent = 40;
    }
    if (kind === "complex") {
      advancePercent = 45;
      jurisdiction = "成都";
      penaltyPercent = 35;
    }
    const kindLabel = kind === "clean" ? "通过" : kind === "single" ? "单点问题" : "复合问题";
    cases.push({
      id,
      scenarioId: "filler",
      title: `${template.title}（${kindLabel}）`,
      summary: `${partyB} · ${template.label} · ${kind}`,
      verifies: "队列与驾驶舱填充量",
      createdAt,
      text: clean({
        title: template.title,
        partyB,
        roleA: template.roleA,
        roleB: template.roleB,
        subject: template.subject,
        amountChinese: amount.amountChinese,
        amountNumber: amount.amountNumber,
        advancePercent,
        penaltyPercent,
        jurisdiction,
        includeTermination,
        signedAt,
      }),
    });
  }
  return cases;
}

export function fillerKindCounts(cases: ScenarioCase[]): {
  clean: number;
  single: number;
  complex: number;
} {
  const counts = { clean: 0, single: 0, complex: 0 };
  for (const item of cases) {
    if (item.summary.endsWith("clean")) counts.clean += 1;
    else if (item.summary.endsWith("single")) counts.single += 1;
    else counts.complex += 1;
  }
  return counts;
}
