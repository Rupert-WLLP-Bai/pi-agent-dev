import type { SubjectCandidate } from "./model";
import type { SubjectVerificationOutcome, SubjectVerificationPort } from "./ports";

/**
 * Deterministic stand-in for the Qichacha agent platform, shaped after the real
 * `get_company_risk_scan` response recorded in
 * docs/integrations/qcc-mcp/samples/. It exists so the subject dimension can be
 * demonstrated and tested without spending provider credits; the real adapter
 * implements the same port.
 */

const CACHE_TTL_DAYS = 7;
const ORGANIZATION_SUFFIX = /(公司|企业|合伙|事务所|合作社|中心|厂|店|院|校|部|局)$/u;

/** Factor names and drill-down tools copied from the recorded provider scan. */
const FACTORS: Array<{ factor: string; detailTool: string }> = [
  { factor: "失信信息", detailTool: "get_dishonest_info" },
  { factor: "被执行人", detailTool: "get_judgment_debtor_info" },
  { factor: "限制高消费", detailTool: "get_high_consumption_restriction" },
  { factor: "严重违法", detailTool: "get_serious_violation" },
  { factor: "经营异常", detailTool: "get_business_exception" },
  { factor: "税务非正常户", detailTool: "get_tax_abnormal" },
  { factor: "破产重整", detailTool: "get_bankruptcy_reorganization" },
  { factor: "股权冻结", detailTool: "get_equity_freeze" },
  { factor: "裁判文书", detailTool: "get_judicial_documents" },
  { factor: "立案信息", detailTool: "get_case_filing_info" },
  { factor: "开庭公告", detailTool: "get_hearing_notice" },
  { factor: "股权出质", detailTool: "get_equity_pledge_info" },
];

/** Counts observed by the recorded scan for one subject. */
type Counts = Partial<Record<string, number>>;

const SUBJECTS: Record<string, { candidate: SubjectCandidate; counts: Counts }> = {
  重庆恒昌建筑工程有限公司: {
    candidate: {
      name: "重庆恒昌建筑工程有限公司",
      unifiedSocialCreditCode: "91500108MA5U7X2K3D",
      registrationStatus: "存续",
    },
    counts: { 失信信息: 2, 被执行人: 1, 裁判文书: 12, 开庭公告: 5 },
  },
  深圳精工科技有限公司: {
    candidate: {
      name: "深圳精工科技有限公司",
      unifiedSocialCreditCode: "91440300MA5F1PQR7X",
      registrationStatus: "存续",
    },
    counts: { 裁判文书: 3, 股权出质: 1 },
  },
  重庆华盛贸易有限公司: {
    candidate: {
      name: "重庆华盛贸易有限公司",
      unifiedSocialCreditCode: "91500103MA5U9T8L2B",
      registrationStatus: "存续",
    },
    counts: {},
  },
  // Remaining demo counterparties resolve cleanly, so only the contracts meant
  // to exercise a branch actually do.
  成都建工集团有限公司: {
    candidate: {
      name: "成都建工集团有限公司",
      unifiedSocialCreditCode: "91510100MA6C2W9H4K",
      registrationStatus: "存续",
    },
    counts: { 裁判文书: 41, 开庭公告: 7 },
  },
  昆明矿业发展有限公司: {
    candidate: {
      name: "昆明矿业发展有限公司",
      unifiedSocialCreditCode: "91530100MA6P4L8N2R",
      registrationStatus: "存续",
    },
    counts: { 裁判文书: 6 },
  },
  杭州智联科技有限公司: {
    candidate: {
      name: "杭州智联科技有限公司",
      unifiedSocialCreditCode: "91330106MA2G7T5X8Y",
      registrationStatus: "存续",
    },
    counts: {},
  },
  东莞芯创电子有限公司: {
    candidate: {
      name: "东莞芯创电子有限公司",
      unifiedSocialCreditCode: "91441900MA4W9K3P6L",
      registrationStatus: "存续",
    },
    counts: { 开庭公告: 2 },
  },
  宁波安达物流有限公司: {
    candidate: {
      name: "宁波安达物流有限公司",
      unifiedSocialCreditCode: "91330200MA2H8Q1R5T",
      registrationStatus: "存续",
    },
    counts: {},
  },
  苏州远航机械有限公司: {
    candidate: {
      name: "苏州远航机械有限公司",
      unifiedSocialCreditCode: "91320500MA1N6C2D8F",
      registrationStatus: "存续",
    },
    counts: { 裁判文书: 2 },
  },
  武汉光谷软件有限公司: {
    candidate: {
      name: "武汉光谷软件有限公司",
      unifiedSocialCreditCode: "91420100MA4K8P3Q7R",
      registrationStatus: "存续",
    },
    counts: {},
  },
  青岛海川贸易有限公司: {
    candidate: {
      name: "青岛海川贸易有限公司",
      unifiedSocialCreditCode: "91370200MA3D5T9W2X",
      registrationStatus: "存续",
    },
    counts: { 开庭公告: 1 },
  },
  西安西部材料有限公司: {
    candidate: {
      name: "西安西部材料有限公司",
      unifiedSocialCreditCode: "91610100MA7B4L6N1P",
      registrationStatus: "存续",
    },
    counts: {},
  },
  长沙湘能电力有限公司: {
    candidate: {
      name: "长沙湘能电力有限公司",
      unifiedSocialCreditCode: "91430100MA8C2V5Y9Z",
      registrationStatus: "存续",
    },
    counts: { 股权出质: 1 },
  },
  合肥智造装备有限公司: {
    candidate: {
      name: "合肥智造装备有限公司",
      unifiedSocialCreditCode: "91340100MA2E7G4H8J",
      registrationStatus: "存续",
    },
    counts: {},
  },
  南京云启信息有限公司: {
    candidate: {
      name: "南京云启信息有限公司",
      unifiedSocialCreditCode: "91320100MA5F9K1M3N",
      registrationStatus: "存续",
    },
    counts: { 裁判文书: 4 },
  },
  天津滨海物流有限公司: {
    candidate: {
      name: "天津滨海物流有限公司",
      unifiedSocialCreditCode: "91120100MA6H3P8Q2R",
      registrationStatus: "存续",
    },
    counts: {},
  },
  福州海峡建设有限公司: {
    candidate: {
      name: "福州海峡建设有限公司",
      unifiedSocialCreditCode: "91350100MA9J5S7T4U",
      registrationStatus: "存续",
    },
    counts: { 开庭公告: 3 },
  },
  郑州中原机电有限公司: {
    candidate: {
      name: "郑州中原机电有限公司",
      unifiedSocialCreditCode: "91410100MA1K8W2X6Y",
      registrationStatus: "存续",
    },
    counts: {},
  },
};

function buildDimensions(counts: Counts) {
  return FACTORS.map(({ factor, detailTool }) => ({
    factor,
    count: counts[factor] ?? 0,
    detailTool,
  }));
}

function summarize(counts: Counts): string {
  const hits = Object.entries(counts).filter(([, count]) => (count ?? 0) > 0);
  if (hits.length === 0) {
    return "已全量扫描风险因子：全部无记录。此项核心合规风控排查安全，允许进入下一步审计。";
  }
  const detail = hits.map(([factor, count]) => `${factor}(${count})`).join("、");
  return `已全量扫描风险因子：${hits.length} 项有记录。有记录：${detail}。各因子明细请调用其「明细工具」。`;
}

/** Candidate names used when a party name cannot be resolved to one subject. */
function ambiguousCandidates(subject: string): SubjectCandidate[] {
  return [
    {
      name: `${subject}（集团）有限公司`,
      unifiedSocialCreditCode: "91500108MA5U7X2K3D",
      registrationStatus: "存续",
    },
    {
      name: `${subject}有限公司`,
      unifiedSocialCreditCode: "91500103MA5U9T8L2B",
      registrationStatus: "存续",
    },
  ];
}

export interface FixtureAdapterOptions {
  /** Subject names that should fail, used to exercise the degraded branch. */
  unavailable?: Iterable<string>;
}

function cacheExpiry(capturedAt: string): string {
  const expires = new Date(capturedAt);
  expires.setDate(expires.getDate() + CACHE_TTL_DAYS);
  return expires.toISOString();
}

export function createFixtureSubjectVerificationPort(
  options: FixtureAdapterOptions = {},
): SubjectVerificationPort {
  const unavailable = new Set(options.unavailable ?? []);

  return {
    provider: "qcc-fixture",
    tool: "get_company_risk_scan",
    async verify(subject: string): Promise<SubjectVerificationOutcome> {
      const capturedAt = new Date().toISOString();

      if (unavailable.has(subject)) {
        return {
          status: "UNAVAILABLE",
          candidates: [],
          matched: null,
          dimensions: [],
          summary: "",
          capturedAt,
          expiresAt: null,
          failureReason: "核验来源连接超时",
        };
      }

      // The provider refuses to guess when a name has no organization suffix;
      // it answers with candidates and requires a second-stage confirmation.
      if (!ORGANIZATION_SUFFIX.test(subject)) {
        return {
          status: "AMBIGUOUS",
          candidates: ambiguousCandidates(subject),
          matched: null,
          dimensions: [],
          summary: `检索到多个匹配主体，请提供统一社会信用代码二次核验。`,
          capturedAt,
          expiresAt: cacheExpiry(capturedAt),
          failureReason: null,
        };
      }

      const known = SUBJECTS[subject];
      if (!known) {
        return {
          status: "UNRESOLVED",
          candidates: [],
          matched: null,
          dimensions: [],
          summary: `经全量核查未发现名为「${subject}」的存续主体。`,
          capturedAt,
          expiresAt: cacheExpiry(capturedAt),
          failureReason: null,
        };
      }

      return {
        status: "RESOLVED",
        candidates: [],
        matched: known.candidate,
        dimensions: buildDimensions(known.counts),
        summary: summarize(known.counts),
        capturedAt,
        expiresAt: cacheExpiry(capturedAt),
        failureReason: null,
      };
    },
  };
}
