import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseContractFile } from "../../apps/api/src/document/index.ts";
import { inferContractStance } from "../../packages/audit/src/contract-stance.ts";
import {
  type ContractTotal,
  extractSheetTotals,
  reviewAmountChain,
  type SheetTotal,
} from "../../packages/audit/src/dossier-consistency.ts";
import { extractContractParties } from "../../packages/audit/src/party-extractor.ts";
import { readStatedTotals } from "../../packages/audit/src/stated-total.ts";

/**
 * Probes the amount chain of one dossier directory from the command line, so a
 * real folder can be fed through the same reconciliation the upload endpoint
 * runs — parse every contract and spreadsheet, read the totals each states, and
 * report which contract total matches which sheet cell.
 */

const DEFAULT_OWN_ORGANIZATION_NAMES = "中国移动通信集团重庆有限公司,重庆移动";
const PARSEABLE_EXTENSIONS: Record<string, true> = {
  ".xlsx": true,
  ".docx": true,
  ".pdf": true,
  ".txt": true,
  ".md": true,
};

const USAGE = "用法：bun scripts/research/probe-amount-chain.ts <目录> [己方名称(逗号分隔)]";

/** Chinese-aware ordering: a code-unit sort scatters CJK dossier names. */
const PATH_ORDER = new Intl.Collator("zh");

const extensionOf = (name: string): string => {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
};

/** Every parseable file under `dir`, dot entries skipped, sorted for stable output. */
async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile() && PARSEABLE_EXTENSIONS[extensionOf(entry.name)] !== undefined) {
      files.push(path);
    }
  }
  return files;
}

const sideLabel = (side: SheetTotal["side"]): string =>
  side === "customer" ? "客户侧" : side === "supplier" ? "供应商侧" : "—";

const taxLabel = (taxIncluded: SheetTotal["taxIncluded"]): string =>
  taxIncluded === true ? "含税" : taxIncluded === false ? "不含税" : "未标注";

/** Side, tax basis, and whether the sheet typed the number in rather than computing it. */
const annotate = (total: SheetTotal): string =>
  `［侧别：${sideLabel(total.side)} · 税基：${taxLabel(total.taxIncluded)} · ${
    total.derived ? "非手填" : "手填"
  }］`;

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined || dir.length === 0) {
    console.log(USAGE);
    process.exit(1);
  }
  const ownNames = (process.argv[3] ?? DEFAULT_OWN_ORGANIZATION_NAMES)
    .split(/[,，]/u)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const totals: SheetTotal[] = [];
  const contracts: ContractTotal[] = [];

  for (const path of (await collectFiles(dir)).sort((a, b) => PATH_ORDER.compare(a, b))) {
    const name = basename(path);
    try {
      const parsed = await parseContractFile({
        filename: name,
        data: new Uint8Array(await readFile(path)),
      });

      if (parsed.spreadsheet !== undefined) {
        const found = extractSheetTotals(parsed.spreadsheet.cells);
        totals.push(...found);
        console.log(`[表] ${name}: ${found.length} 处合计`);
        continue;
      }

      const parties = extractContractParties({ sourceRecordId: "s", document: parsed.document });
      const stance = inferContractStance({
        parties: parties.parties,
        ownOrganizationNames: ownNames,
      });
      const stated = readStatedTotals(parsed.document);
      console.log(`[合同] ${name}`);
      console.log(`  立场: ${stance.stance ?? "未判定"}`);
      console.log(`  立场依据: ${stance.basis}`);
      for (const total of stated) console.log(`  载明: ${total.amount}（${total.basis}）`);
      if (stance.stance === null) continue;
      for (const total of stated) {
        contracts.push({
          artifactName: name,
          blockId: total.blockId,
          amount: total.amount,
          stance: stance.stance,
          taxIncluded: total.taxIncluded,
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`[跳过] ${name}: ${detail}`);
    }
  }

  const report = reviewAmountChain({ contracts, totals });
  console.log("\n=== 金额链核对 ===");
  console.log(
    `核对 ${report.checked} 项：一致 ${report.matched.length}，不一致 ${report.mismatched.length}，无可比对象 ${report.unchecked.length}；手填合计 ${report.handEnteredTotals.length}`,
  );
  for (const result of report.matched) {
    if (result.status !== "MATCHED") continue;
    console.log(
      `  ✓ ${result.contract.artifactName} ${result.contract.amount} = ${result.matched.sheet}!${result.matched.ref}（${result.matched.label}）${annotate(result.matched)}`,
    );
  }
  for (const result of report.mismatched) {
    if (result.status !== "MISMATCHED") continue;
    console.log(
      `  ✗ ${result.contract.artifactName} ${result.contract.amount} ≠ ${result.nearest.sheet}!${result.nearest.ref} ${result.nearest.amount}，差 ${result.difference}${annotate(result.nearest)}`,
    );
  }
  for (const total of report.handEnteredTotals) {
    console.log(
      `  ! 手填合计 ${total.sheet}!${total.ref} = ${total.amount}（${total.label}）${annotate(total)}`,
    );
  }
}

await main();
