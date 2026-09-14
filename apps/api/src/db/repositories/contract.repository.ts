import type { Contract, ContractRevision, RuleCode } from "@contract-audit/audit/model";
import {
  diffAdjacentRevisionFindings,
  type RevisionFindingDiff,
  type RevisionFindingPin,
} from "@contract-audit/audit/revision-finding-diff";
import { desc, eq, inArray } from "drizzle-orm";
import { auditCases, contractRevisions, contracts, findingRevisions } from "../schema";
import { contractTitleFromFirstBlock } from "./helpers";
import type { DrizzleDB } from "./types";

export interface ContractListItem {
  id: string;
  title: string;
  createdAt: string;
  revisionCount: number;
  latestVersion: number | null;
}

export interface ContractRevisionView {
  revision: ContractRevision;
  auditCaseId: string | null;
  caseStatus: string | null;
  findingPins: RevisionFindingPin[];
}

export interface ContractDetailView {
  contract: Contract;
  revisions: ContractRevisionView[];
  diffs: Array<{ fromVersion: number; toVersion: number; diff: RevisionFindingDiff }>;
}

/** Registers a Source Record as a new or next Contract Revision within a transaction. */
export async function registerContractRevision(
  db: DrizzleDB,
  input: {
    sourceRecordId: string;
    title: string;
    contractId?: string | null;
  },
): Promise<string> {
  const title = input.title.trim() || "未命名合同";
  if (input.contractId) {
    const [latest] = await db
      .select({ version: contractRevisions.version })
      .from(contractRevisions)
      .where(eq(contractRevisions.contractId, input.contractId))
      .orderBy(desc(contractRevisions.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    const [revision] = await db
      .insert(contractRevisions)
      .values({
        contractId: input.contractId,
        version,
        sourceRecordId: input.sourceRecordId,
        label: `v${version}`,
      })
      .returning({ id: contractRevisions.id });
    return revision.id;
  }

  const [contract] = await db.insert(contracts).values({ title }).returning({ id: contracts.id });
  const [revision] = await db
    .insert(contractRevisions)
    .values({
      contractId: contract.id,
      version: 1,
      sourceRecordId: input.sourceRecordId,
      label: "v1",
    })
    .returning({ id: contractRevisions.id });
  return revision.id;
}

const toContract = (row: typeof contracts.$inferSelect): Contract => ({
  id: row.id,
  title: row.title,
  createdAt: row.createdAt.toISOString(),
});

const toRevision = (row: typeof contractRevisions.$inferSelect): ContractRevision => ({
  id: row.id,
  contractId: row.contractId,
  version: row.version,
  sourceRecordId: row.sourceRecordId,
  label: row.label,
  createdAt: row.createdAt.toISOString(),
});

export class ContractRepository {
  constructor(private readonly db: DrizzleDB) {}

  async listContracts(): Promise<ContractListItem[]> {
    const contractRows = await this.db.select().from(contracts).orderBy(desc(contracts.createdAt));
    if (contractRows.length === 0) return [];
    const contractIds = contractRows.map((row) => row.id);
    const revisionRows = await this.db
      .select()
      .from(contractRevisions)
      .where(inArray(contractRevisions.contractId, contractIds));

    const stats = new Map<string, { count: number; latestVersion: number }>();
    for (const revision of revisionRows) {
      const current = stats.get(revision.contractId) ?? { count: 0, latestVersion: 0 };
      current.count += 1;
      current.latestVersion = Math.max(current.latestVersion, revision.version);
      stats.set(revision.contractId, current);
    }

    return contractRows.map((row) => {
      const summary = stats.get(row.id);
      return {
        id: row.id,
        title: row.title,
        createdAt: row.createdAt.toISOString(),
        revisionCount: summary?.count ?? 0,
        latestVersion: summary ? summary.latestVersion : null,
      };
    });
  }

  async getContract(contractId: string): Promise<ContractDetailView | null> {
    const [contractRow] = await this.db
      .select()
      .from(contracts)
      .where(eq(contracts.id, contractId))
      .limit(1);
    if (!contractRow) return null;

    const revisionRows = await this.db
      .select()
      .from(contractRevisions)
      .where(eq(contractRevisions.contractId, contractId))
      .orderBy(contractRevisions.version);

    const revisionIds = revisionRows.map((row) => row.id);
    const caseRows =
      revisionIds.length === 0
        ? []
        : await this.db
            .select({
              id: auditCases.id,
              status: auditCases.status,
              contractRevisionId: auditCases.contractRevisionId,
            })
            .from(auditCases)
            .where(inArray(auditCases.contractRevisionId, revisionIds));

    const caseByRevision = new Map(
      caseRows.map((row) => [row.contractRevisionId ?? "", { id: row.id, status: row.status }]),
    );

    const revisions: ContractRevisionView[] = [];
    for (const row of revisionRows) {
      const linked = caseByRevision.get(row.id);
      const findingPins = linked ? await this.findingPinsForCase(linked.id) : [];
      revisions.push({
        revision: toRevision(row),
        auditCaseId: linked?.id ?? null,
        caseStatus: linked?.status ?? null,
        findingPins,
      });
    }

    const diffs: ContractDetailView["diffs"] = [];
    for (let index = 1; index < revisions.length; index += 1) {
      const prior = revisions[index - 1];
      const next = revisions[index];
      diffs.push({
        fromVersion: prior.revision.version,
        toVersion: next.revision.version,
        diff: diffAdjacentRevisionFindings(prior.findingPins, next.findingPins),
      });
    }

    return { contract: toContract(contractRow), revisions, diffs };
  }

  async contractIdForCase(caseId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ contractId: contractRevisions.contractId })
      .from(auditCases)
      .innerJoin(contractRevisions, eq(auditCases.contractRevisionId, contractRevisions.id))
      .where(eq(auditCases.id, caseId))
      .limit(1);
    return row?.contractId ?? null;
  }

  /** Title helper for registerContractRevision from pasted text or file name. */
  static titleFromSource(sourceText: string, displayName: string | null): string {
    const fromBlock = contractTitleFromFirstBlock(sourceText.split("\n")[0]);
    if (fromBlock) return fromBlock;
    if (displayName) {
      const stripped = displayName.replace(/\.(docx|pdf|txt|md)$/i, "").trim();
      if (stripped.length > 0) return stripped;
    }
    return "未命名合同";
  }

  private async findingPinsForCase(caseId: string): Promise<RevisionFindingPin[]> {
    const rows = await this.db
      .select()
      .from(findingRevisions)
      .where(eq(findingRevisions.auditCaseId, caseId));
    const superseded = new Set(
      rows.flatMap((row) => (row.supersedesId === null ? [] : [row.supersedesId])),
    );
    const heads = rows.filter((row) => !superseded.has(row.id));
    const pins: RevisionFindingPin[] = [];
    for (const row of heads) {
      const ruleCode = row.ruleCode as RuleCode | null;
      if (!ruleCode) continue;
      pins.push({
        ruleCode,
        findingType: row.proposal.findingType,
        severity: row.proposal.severity,
      });
    }
    return pins;
  }

  async registerRevision(
    sourceRecordId: string,
    title: string,
    contractId?: string | null,
  ): Promise<string> {
    return registerContractRevision(this.db, { sourceRecordId, title, contractId });
  }

  /** Resolves revision id for an existing contract revision row (tests / seed). */
  async linkCaseToRevision(caseId: string, contractRevisionId: string): Promise<void> {
    await this.db
      .update(auditCases)
      .set({ contractRevisionId, updatedAt: new Date() })
      .where(eq(auditCases.id, caseId));
  }

  /** Backfill helper: attach revision when legacy rows predate contracts. */
  async ensureCaseRevision(
    caseId: string,
    sourceRecordId: string,
    sourceText: string,
    displayName: string | null,
  ): Promise<string> {
    const [existing] = await this.db
      .select({ contractRevisionId: auditCases.contractRevisionId })
      .from(auditCases)
      .where(eq(auditCases.id, caseId))
      .limit(1);
    if (existing?.contractRevisionId) return existing.contractRevisionId;
    const revisionId = await registerContractRevision(this.db, {
      sourceRecordId,
      title: ContractRepository.titleFromSource(sourceText, displayName),
    });
    await this.db
      .update(auditCases)
      .set({ contractRevisionId: revisionId, updatedAt: new Date() })
      .where(eq(auditCases.id, caseId));
    return revisionId;
  }
}
