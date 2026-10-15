/**
 * The synthetic Chinese clause fixture set for the shadow decision layer.
 *
 * Every clause here was written for this evaluation: no production contract,
 * no customer material and no third-party text appears in this file. The
 * labels are **developer reference labels** — authored by the implementing
 * engineer against the stated criteria, not signed off by an independent
 * human expert panel, so no result computed over them may be described as an
 * independent gold-standard measurement.
 *
 * Coverage requirements this set satisfies:
 * - ten categories (payment, liability, force_majeure, termination,
 *   acceptance, dispute, confidentiality, party, amount, attachment_conflict);
 * - at least 60 clauses;
 * - for every category: a positive case, a negative case, an ambiguous case,
 *   and either an exception case or a cross-clause case;
 * - a stated reason for every label, and a review status for every clause.
 */

/** The ten clause categories the catalogue's `clause-category` question asks about. */
export const FIXTURE_CATEGORIES = [
  "payment",
  "liability",
  "force_majeure",
  "termination",
  "acceptance",
  "dispute",
  "confidentiality",
  "party",
  "amount",
  "attachment_conflict",
] as const;

export type FixtureCategory = (typeof FIXTURE_CATEGORIES)[number];

/** Which judgement shape a clause exercises. */
export type FixtureCaseKind = "positive" | "negative" | "ambiguous" | "exception" | "cross_clause";

/** Whether the label is settled enough to act on without a human look. */
export type FixtureReviewStatus = "settled" | "needs_human_review";

export interface SyntheticClauseFixture {
  id: string;
  category: FixtureCategory;
  kind: FixtureCaseKind;
  /** The clause text itself, synthetic. */
  clause: string;
  /** The developer reference label for `clause-category`. */
  label: FixtureCategory;
  /** Why this label, in one sentence. */
  reason: string;
  /** Whether a reviewer must look before the label is used. */
  reviewStatus: FixtureReviewStatus;
  /**
   * For a cross-clause case: the clause this one interacts with, by id. Null
   * otherwise. The pair is only interpretable together.
   */
  pairsWith: string | null;
}

const clause = (
  id: string,
  category: FixtureCategory,
  kind: FixtureCaseKind,
  text: string,
  reason: string,
  reviewStatus: FixtureReviewStatus,
  pairsWith: string | null = null,
): SyntheticClauseFixture => ({
  id,
  category,
  kind,
  clause: text,
  label: category,
  reason,
  reviewStatus,
  pairsWith,
});

/**
 * The set. Ten categories, each with a positive, a negative, an ambiguous and
 * an exception/cross-clause clause — 60 clauses in total, numbered by category
 * so a gap is visible.
 */
export const syntheticClauseFixtures: readonly SyntheticClauseFixture[] = [
  // ── 付款 payment ──────────────────────────────────────────────
  clause(
    "payment-01",
    "payment",
    "positive",
    "甲方应在合同签订后十个工作日内，向乙方支付合同总价的百分之三十作为预付款。",
    "明确约定付款比例、时间与触发条件。",
    "settled",
  ),
  clause(
    "payment-02",
    "payment",
    "negative",
    "本条款约定争议解决方式为向合同签订地有管辖权的人民法院提起诉讼。",
    "内容属于争议解决，不属于付款安排。",
    "settled",
  ),
  clause(
    "payment-03",
    "payment",
    "ambiguous",
    "双方应在合理期限内完成结算，具体金额以双方后续确认的书面文件为准。",
    "未约定明确比例、期限或触发条件，付款要素不完整。",
    "needs_human_review",
  ),
  clause(
    "payment-04",
    "payment",
    "exception",
    "除乙方提交符合要求的履约保函外，甲方不承担任何预付款义务。",
    "以例外条件限定付款义务，需结合保函条款判断实际安排。",
    "needs_human_review",
  ),
  clause(
    "payment-05",
    "payment",
    "cross_clause",
    "若验收条款约定的验收未通过，本条预付款应予退还。",
    "付款义务以另一条款的验收结果为前提，须与验收条款合并理解。",
    "needs_human_review",
    "acceptance-01",
  ),
  clause(
    "payment-06",
    "payment",
    "positive",
    "剩余价款分两期支付：交付后支付百分之五十，验收合格后支付尾款。",
    "分期付款的时间节点与比例均明确。",
    "settled",
  ),

  // ── 违约责任 liability ───────────────────────────────────────
  clause(
    "liability-01",
    "liability",
    "positive",
    "任何一方违约，应向守约方支付合同总价百分之十的违约金。",
    "明确约定违约金比例与适用情形。",
    "settled",
  ),
  clause(
    "liability-02",
    "liability",
    "negative",
    "本合同自双方签字盖章之日起生效。",
    "内容属于生效要件，不属于违约责任。",
    "settled",
  ),
  clause(
    "liability-03",
    "liability",
    "ambiguous",
    "违约方应赔偿守约方因此遭受的损失。",
    "未区分直接损失与间接损失，也未约定赔偿上限。",
    "needs_human_review",
  ),
  clause(
    "liability-04",
    "liability",
    "exception",
    "但因不可抗力导致的迟延履行，不适用本条违约金。",
    "以不可抗力排除违约金适用，属例外条款。",
    "needs_human_review",
    "force-majeure-01",
  ),
  clause(
    "liability-05",
    "liability",
    "cross_clause",
    "本条违约金与质量保证金扣罚可同时适用，累计不超过合同总价的百分之二十。",
    "与质量保证金条款叠加并设总额上限，须合并计算。",
    "needs_human_review",
    "acceptance-04",
  ),
  clause(
    "liability-06",
    "liability",
    "positive",
    "乙方逾期交付的，每逾期一日按合同总价的千分之三向甲方支付违约金。",
    "明确逾期违约金的计算方式与比率。",
    "settled",
  ),

  // ── 不可抗力 force_majeure ───────────────────────────────────
  clause(
    "force-majeure-01",
    "force_majeure",
    "positive",
    "因地震、洪水、台风等不可抗力不能履行合同的，根据不可抗力的影响，部分或者全部免除责任。",
    "明确列举不可抗力情形并约定免责效果。",
    "settled",
  ),
  clause(
    "force-majeure-02",
    "force_majeure",
    "negative",
    "乙方应保证其提供的设备符合国家强制性标准。",
    "内容属于质量保证义务，不属于不可抗力。",
    "settled",
  ),
  clause(
    "force-majeure-03",
    "force_majeure",
    "ambiguous",
    "因客观原因导致无法按期履约的，双方可协商顺延。",
    "“客观原因”未限定为不可抗力，范围不清。",
    "needs_human_review",
  ),
  clause(
    "force-majeure-04",
    "force_majeure",
    "exception",
    "但不可抗力发生在迟延履行期间的，迟延方不得据此免责。",
    "对不可抗力免责设置时间例外，须结合履行时间线判断。",
    "needs_human_review",
  ),
  clause(
    "force-majeure-05",
    "force_majeure",
    "cross_clause",
    "受不可抗力影响的一方应在不可抗力发生后五日内书面通知对方，否则按违约责任处理。",
    "通知义务与违约责任条款联动，未通知的后果在另一条款。",
    "needs_human_review",
    "liability-01",
  ),
  clause(
    "force-majeure-06",
    "force_majeure",
    "positive",
    "不可抗力事件持续超过六十日的，任何一方均有权解除合同。",
    "约定不可抗力持续达到期限时的解除权。",
    "settled",
  ),

  // ── 终止/续约 termination ────────────────────────────────────
  clause(
    "termination-01",
    "termination",
    "positive",
    "任何一方提前三十日书面通知对方，可以解除本合同。",
    "明确约定单方解除权与通知期限。",
    "settled",
  ),
  clause(
    "termination-02",
    "termination",
    "negative",
    "本合同项下的技术资料归甲方所有。",
    "内容属于知识产权归属，不属于终止或续约。",
    "settled",
  ),
  clause(
    "termination-03",
    "termination",
    "ambiguous",
    "双方合作不满意的，可以结束合作。",
    "未约定通知期限、结束程序或已发生费用的处理。",
    "needs_human_review",
  ),
  clause(
    "termination-04",
    "termination",
    "exception",
    "但合同已进入验收阶段的，解除须经双方书面确认。",
    "对解除权设置阶段例外，须先判断当前所处阶段。",
    "needs_human_review",
  ),
  clause(
    "termination-05",
    "termination",
    "cross_clause",
    "合同解除后，已验收部分的付款义务不受影响，按付款条款继续履行。",
    "解除后果与付款条款交叉，须合并判断解除后的付款范围。",
    "needs_human_review",
    "payment-06",
  ),
  clause(
    "termination-06",
    "termination",
    "positive",
    "本合同期满前六十日内，双方可协商续约，续约期限为一年。",
    "明确约定续约的时间窗口与期限。",
    "settled",
  ),

  // ── 验收 acceptance ──────────────────────────────────────────
  clause(
    "acceptance-01",
    "acceptance",
    "positive",
    "乙方交付设备后，甲方应在十五个工作日内完成验收，并出具书面验收报告。",
    "明确验收主体、期限与成果形式。",
    "settled",
  ),
  clause(
    "acceptance-02",
    "acceptance",
    "negative",
    "本合同适用中华人民共和国法律。",
    "内容属于法律适用，不属于验收安排。",
    "settled",
  ),
  clause(
    "acceptance-03",
    "acceptance",
    "ambiguous",
    "甲方认为设备符合要求的，即视为验收合格。",
    "未约定验收标准、期限与异议程序。",
    "needs_human_review",
  ),
  clause(
    "acceptance-04",
    "acceptance",
    "exception",
    "但涉及甲方内部流程审批的部分，验收期限相应顺延。",
    "以内部审批例外延长验收期限，顺延上限未约定。",
    "needs_human_review",
  ),
  clause(
    "acceptance-05",
    "acceptance",
    "cross_clause",
    "验收不合格的，乙方应在十日内整改，整改费用按违约责任条款处理。",
    "整改义务与违约责任条款联动。",
    "needs_human_review",
    "liability-01",
  ),
  clause(
    "acceptance-06",
    "acceptance",
    "positive",
    "验收分为到货验收与最终验收两个阶段，分别签署到货验收单与最终验收报告。",
    "明确两阶段验收的形式与成果。",
    "settled",
  ),

  // ── 管辖 dispute ─────────────────────────────────────────────
  clause(
    "dispute-01",
    "dispute",
    "positive",
    "因本合同引起的争议，双方应提交北京仲裁委员会仲裁解决。",
    "明确约定仲裁机构与争议范围。",
    "settled",
  ),
  clause(
    "dispute-02",
    "dispute",
    "negative",
    "乙方应对其在履行过程中知悉的甲方商业秘密承担保密义务。",
    "内容属于保密义务，不属于争议解决。",
    "settled",
  ),
  clause(
    "dispute-03",
    "dispute",
    "ambiguous",
    "发生争议时，双方应友好协商解决。",
    "仅约定协商，未约定协商不成后的管辖或仲裁方式。",
    "needs_human_review",
  ),
  clause(
    "dispute-04",
    "dispute",
    "exception",
    "但涉及货款支付的争议，仍应向甲方所在地人民法院提起诉讼。",
    "对部分争议类型设置法院管辖例外，与仲裁约定并存。",
    "needs_human_review",
    "dispute-01",
  ),
  clause(
    "dispute-05",
    "dispute",
    "cross_clause",
    "仲裁期间，除争议部分外，双方应继续履行本合同其他条款。",
    "争议解决与合同继续履行交叉，须结合付款条款判断范围。",
    "needs_human_review",
    "payment-01",
  ),
  clause(
    "dispute-06",
    "dispute",
    "positive",
    "诉讼由合同签订地人民法院管辖，适用第一审程序。",
    "明确约定法院管辖的连接点。",
    "settled",
  ),

  // ── 隐私保密 confidentiality ─────────────────────────────────
  clause(
    "confidentiality-01",
    "confidentiality",
    "positive",
    "双方对本合同内容及履行过程中知悉的对方商业秘密负有保密义务，期限为五年。",
    "明确保密范围与期限。",
    "settled",
  ),
  clause(
    "confidentiality-02",
    "confidentiality",
    "negative",
    "甲方逾期付款的，按逾期金额每日万分之五支付违约金。",
    "内容属于付款违约，不属于保密安排。",
    "settled",
  ),
  clause(
    "confidentiality-03",
    "confidentiality",
    "ambiguous",
    "一方不得泄露另一方的相关信息。",
    "保密范围与“相关信息”的边界不清，期限也未约定。",
    "needs_human_review",
  ),
  clause(
    "confidentiality-04",
    "confidentiality",
    "exception",
    "但依法律法规或监管要求必须披露的信息，不受本条限制。",
    "以法定披露义务作为保密例外。",
    "needs_human_review",
  ),
  clause(
    "confidentiality-05",
    "confidentiality",
    "cross_clause",
    "保密义务不因本合同终止而失效，终止后的处理按终止条款执行。",
    "保密期限与合同终止条款交叉，须合并判断存续期。",
    "needs_human_review",
    "termination-01",
  ),
  clause(
    "confidentiality-06",
    "confidentiality",
    "positive",
    "未经甲方书面同意，乙方不得将甲方经营数据用于本合同以外的任何用途。",
    "明确数据用途限制与同意要件。",
    "settled",
  ),

  // ── 主体 party ───────────────────────────────────────────────
  clause(
    "party-01",
    "party",
    "positive",
    "甲方为依照中华人民共和国法律设立并有效存续的有限责任公司。",
    "明确主体性质与存续状态。",
    "settled",
  ),
  clause(
    "party-02",
    "party",
    "negative",
    "设备运输方式为汽运，运费由乙方承担。",
    "内容属于运输安排，不属于主体约定。",
    "settled",
  ),
  clause(
    "party-03",
    "party",
    "ambiguous",
    "由相关方负责办理本次交易所需的各项手续。",
    "“相关方”未指明具体主体，义务归属不清。",
    "needs_human_review",
  ),
  clause(
    "party-04",
    "party",
    "exception",
    "但甲方分支机构在授权范围内可以自己的名义签署履行文件。",
    "对签约主体设置分支机构例外，授权范围未附。",
    "needs_human_review",
  ),
  clause(
    "party-05",
    "party",
    "cross_clause",
    "乙方权利义务可由其承继单位继续行使，承继安排按终止条款办理。",
    "主体承继与终止条款交叉，须结合终止情形判断。",
    "needs_human_review",
    "termination-01",
  ),
  clause(
    "party-06",
    "party",
    "positive",
    "双方法定代表人签署本合同，签署人应提供有效的授权委托书。",
    "明确签署主体与授权文件要求。",
    "settled",
  ),

  // ── 金额 amount ──────────────────────────────────────────────
  clause(
    "amount-01",
    "amount",
    "positive",
    "合同总价为人民币壹佰贰拾万元整（小写：1200000.00元）。",
    "同时给出大写与小写金额，金额要素完整。",
    "settled",
  ),
  clause(
    "amount-02",
    "amount",
    "negative",
    "本合同未尽事宜，由双方另行协商签订补充协议。",
    "内容属于补充协议安排，不属于金额约定。",
    "settled",
  ),
  clause(
    "amount-03",
    "amount",
    "ambiguous",
    "合同价款按实际发生量结算，多退少补。",
    "未约定单价、计价方式或结算依据。",
    "needs_human_review",
  ),
  clause(
    "amount-04",
    "amount",
    "exception",
    "但超过合同总价百分之五的变更，须另行签订书面补充协议。",
    "对金额变更设置幅度例外，须与原价合并判断。",
    "needs_human_review",
    "amount-01",
  ),
  clause(
    "amount-05",
    "amount",
    "cross_clause",
    "上述价款已包含税费，发票类型与开具时间按付款条款执行。",
    "价款含税约定与付款条款交叉。",
    "needs_human_review",
    "payment-01",
  ),
  clause(
    "amount-06",
    "amount",
    "positive",
    "单价为每台人民币三万八千元，数量为十台，总价三十八万元。",
    "单价、数量与总价三者一致且明确。",
    "settled",
  ),

  // ── 附件冲突 attachment_conflict ─────────────────────────────
  clause(
    "attachment-conflict-01",
    "attachment_conflict",
    "positive",
    "附件一技术参数表与本合同正文具有同等法律效力。",
    "明确附件的效力层级。",
    "settled",
  ),
  clause(
    "attachment-conflict-02",
    "attachment_conflict",
    "negative",
    "本合同一式两份，甲乙双方各执一份。",
    "内容属于合同份数，不属于附件冲突。",
    "settled",
  ),
  clause(
    "attachment-conflict-03",
    "attachment_conflict",
    "ambiguous",
    "附件与正文不一致的，以双方协商确定的版本为准。",
    "未约定不一致时的优先顺序与确定程序。",
    "needs_human_review",
  ),
  clause(
    "attachment-conflict-04",
    "attachment_conflict",
    "exception",
    "但附件中的验收标准低于正文约定的，以正文为准。",
    "对附件效力设置方向性例外，须比对两者内容。",
    "needs_human_review",
    "acceptance-01",
  ),
  clause(
    "attachment-conflict-05",
    "attachment_conflict",
    "cross_clause",
    "附件二报价明细与正文总价不一致的，按正文总价执行并相应调整明细。",
    "附件金额与正文金额冲突，须结合金额条款处理。",
    "needs_human_review",
    "amount-01",
  ),
  clause(
    "attachment-conflict-06",
    "attachment_conflict",
    "positive",
    "附件三为履约保函格式，保函内容不得低于正文约定的担保比例。",
    "明确附件与正文在担保比例上的约束关系。",
    "settled",
  ),
];

/** Every cross-clause reference resolves to a clause that exists. */
export const fixtureCrossReferencesResolve = (
  fixtures: readonly SyntheticClauseFixture[] = syntheticClauseFixtures,
): boolean => {
  const ids = new Set(fixtures.map((fixture) => fixture.id));
  return fixtures.every((fixture) => fixture.pairsWith === null || ids.has(fixture.pairsWith));
};

/** Per-category counts, so a report can state exactly what the set covers. */
export const fixtureCategoryCounts = (
  fixtures: readonly SyntheticClauseFixture[] = syntheticClauseFixtures,
): Record<FixtureCategory, number> => {
  const counts = Object.fromEntries(FIXTURE_CATEGORIES.map((category) => [category, 0])) as Record<
    FixtureCategory,
    number
  >;
  for (const fixture of fixtures) counts[fixture.category] += 1;
  return counts;
};

/** Per-review-status counts, so a report states how much needs a human. */
export const fixtureReviewStatusCounts = (
  fixtures: readonly SyntheticClauseFixture[] = syntheticClauseFixtures,
): Record<FixtureReviewStatus, number> => {
  const counts: Record<FixtureReviewStatus, number> = {
    settled: 0,
    needs_human_review: 0,
  };
  for (const fixture of fixtures) counts[fixture.reviewStatus] += 1;
  return counts;
};
