import type { ContractDocument, ContractParty, EvidenceLocator } from "./model";

/**
 * Extracts Contract Parties from a Contract Document deterministically: a
 * labelled line such as `甲方：重庆华盛贸易有限公司（采购方）`. Extraction is
 * a Fact, so it never consults a model — an unreadable contract yields no
 * parties, and the subject rule reports that for human review instead.
 */

const PARTY_LABELS = [
  "甲方",
  "乙方",
  "丙方",
  "丁方",
  "买方",
  "卖方",
  "委托方",
  "受托方",
  "出租方",
  "承租方",
  "发包方",
  "承包方",
] as const;

const PARTY_PATTERN = new RegExp(
  `^\\s*(${PARTY_LABELS.join("|")})\\s*(?:[（(][^）)]{0,12}[）)])?\\s*[:：]\\s*(.+)$`,
  "du",
);

/** Characters that end a party name inside one line. */
const NAME_TERMINATOR = /[，,；;。\s]/u;

/**
 * A trailing qualifier such as `（采购方）`. Only trailing ones are stripped so
 * that a name like `腾讯科技（深圳）有限公司` survives intact.
 */
const TRAILING_QUALIFIER = /[（(][^）)]{1,16}[）)]$/u;

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 40;

export interface PartyExtraction {
  parties: ContractParty[];
  evidence: EvidenceLocator[];
}

export function extractContractParties(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): PartyExtraction {
  const parties: ContractParty[] = [];
  const evidence: EvidenceLocator[] = [];
  const seen = new Set<string>();

  for (const block of input.document.blocks) {
    // Contracts normally write 甲方 and 乙方 on consecutive lines, and the
    // adapter keeps them in one block, so parties are matched per line rather
    // than per block.
    let lineStart = 0;
    for (const rawLine of block.text.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const match = PARTY_PATTERN.exec(line);
      const spans = match?.indices;

      if (match && spans) {
        const rawName = match[2] ?? "";
        const terminator = rawName.search(NAME_TERMINATOR);
        let name = (terminator === -1 ? rawName : rawName.slice(0, terminator)).trim();
        while (TRAILING_QUALIFIER.test(name)) {
          name = name.replace(TRAILING_QUALIFIER, "").trim();
        }

        const label = match[1] ?? "";
        const key = `${label}\u0000${name}`;
        const nameStart = spans[2]?.[0];

        if (
          name.length >= MIN_NAME_LENGTH &&
          name.length <= MAX_NAME_LENGTH &&
          !seen.has(key) &&
          nameStart !== undefined
        ) {
          seen.add(key);

          const partyId = `party-${parties.length + 1}`;
          const evidenceId = `${partyId}-name`;
          const startOffset = Array.from(block.text.slice(0, lineStart + nameStart)).length;

          parties.push({ id: partyId, label, name, evidenceId });
          evidence.push({
            id: evidenceId,
            sourceRecordId: input.sourceRecordId,
            location: {
              kind: "DOCUMENT_SPAN",
              contractDocumentHash: input.document.hash,
              blockId: block.blockId,
              startOffset,
              endOffset: startOffset + Array.from(name).length,
              quotedText: name,
            },
          });
        }
      }

      lineStart += rawLine.length + 1;
    }
  }

  return { parties, evidence };
}
