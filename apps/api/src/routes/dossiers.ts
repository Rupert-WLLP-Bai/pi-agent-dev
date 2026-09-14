import { inferContractStance } from "@contract-audit/audit/contract-stance";
import {
  type ContractTotal,
  extractSheetTotals,
  reviewAmountChain,
  type SheetTotal,
} from "@contract-audit/audit/dossier-consistency";
import { extractContractParties } from "@contract-audit/audit/party-extractor";
import { readStatedTotals } from "@contract-audit/audit/stated-total";
import { Elysia, t } from "elysia";
import { loadApiConfig } from "../config";
import { parseContractFile, validateExtension } from "../document";
import { openapiTags } from "../openapi";

/**
 * Cross-document review over the files of one project dossier.
 *
 * The reconciliation is stateless on purpose. An Audit Case is one contract with
 * a lifecycle — findings, review, remediation — while this answers a question
 * about a *set* of files handed in together, and the answer is a pure function of
 * those bytes. Filing it as a case would either invent a dossier the schema does
 * not have or attach a second meaning to the one it does.
 */

const sheetTotalSchema = t.Object({
  sheet: t.String(),
  ref: t.String({ description: "单元格地址，如 F20" }),
  label: t.String({ description: "该合计的列表头与行标签" }),
  side: t.Union([t.Literal("customer"), t.Literal("supplier"), t.Null()]),
  taxIncluded: t.Union([t.Boolean(), t.Null()]),
  amount: t.Number(),
  derived: t.Boolean({ description: "false 表示手填，表格自身的算术不支持这个数" }),
});

const contractTotalSchema = t.Object({
  artifactName: t.String(),
  blockId: t.String(),
  amount: t.Number(),
  stance: t.Union([t.Literal("revenue"), t.Literal("procurement")]),
  taxIncluded: t.Union([t.Boolean(), t.Null()]),
});

const amountChainSchema = t.Object(
  {
    artifacts: t.Array(
      t.Object({
        name: t.String(),
        kind: t.Union([t.Literal("SPREADSHEET"), t.Literal("CONTRACT")]),
        stance: t.Union([t.Literal("revenue"), t.Literal("procurement"), t.Null()]),
        stanceBasis: t.String({ description: "立场是从哪读出来的，供复核者反驳" }),
        statedTotals: t.Array(t.Object({ amount: t.Number(), basis: t.String() })),
        sheetTotalCount: t.Number(),
        error: t.Union([t.String(), t.Null()]),
      }),
    ),
    sheetTotals: t.Array(sheetTotalSchema),
    checked: t.Number({ description: "实际比对的金额项数" }),
    matched: t.Array(t.Object({ contract: contractTotalSchema, matched: sheetTotalSchema })),
    mismatched: t.Array(
      t.Object({
        contract: contractTotalSchema,
        nearest: sheetTotalSchema,
        difference: t.Number({ description: "合同金额减去最接近的合计" }),
      }),
    ),
    unchecked: t.Array(t.Object({ contract: contractTotalSchema, reason: t.String() })),
    handEnteredTotals: t.Array(sheetTotalSchema),
  },
  { description: "一个项目卷宗内部的金额链核对结果。" },
);

const errorSchema = t.Object({ error: t.String() });

export function dossiersRoutes({ maxUploadBytes }: { maxUploadBytes: number }) {
  return new Elysia().post(
    "/api/dossiers/amount-chain",
    async ({ body, set }) => {
      const files = body.files;
      if (files.length < 2) {
        set.status = 422;
        return { error: "dossier_needs_at_least_two_files" };
      }
      const oversized = files.find((file) => file.size > maxUploadBytes);
      if (oversized !== undefined) {
        set.status = 413;
        return { error: "file_too_large" };
      }
      // Only the extension is checked, and only to pick a parser. The upload
      // endpoint additionally compares the wire-declared part MIME because it
      // persists the file before parsing it; here every file is parsed in this
      // request, so the parse itself is the verdict on what the bytes are, and
      // comparing `file.type` would be vacuous — the multipart parser derives
      // that value from the filename it is being checked against.
      for (const file of files) {
        const unsupported = validateExtension(file.name);
        if (unsupported !== true) {
          set.status = 422;
          return { error: unsupported };
        }
      }

      const ownOrganizationNames =
        body.ownOrganizationNames === undefined
          ? loadApiConfig().ownOrganizationNames
          : body.ownOrganizationNames
              .split(/[,，]/u)
              .map((name) => name.trim())
              .filter((name) => name.length > 0);

      const artifacts: Array<{
        name: string;
        kind: "SPREADSHEET" | "CONTRACT";
        stance: "revenue" | "procurement" | null;
        stanceBasis: string;
        statedTotals: Array<{ amount: number; basis: string }>;
        sheetTotalCount: number;
        error: string | null;
      }> = [];
      const sheetTotals: SheetTotal[] = [];
      const contracts: ContractTotal[] = [];

      for (const file of files) {
        // One unreadable file must not lose the review of the others: a scanned
        // PDF with OCR unconfigured is reported against its own artifact while
        // the rest of the chain is still checked.
        try {
          const parsed = await parseContractFile({
            filename: file.name,
            data: new Uint8Array(await file.arrayBuffer()),
          });

          if (parsed.spreadsheet !== undefined) {
            const found = extractSheetTotals(parsed.spreadsheet.cells);
            sheetTotals.push(...found);
            artifacts.push({
              name: file.name,
              kind: "SPREADSHEET",
              stance: null,
              stanceBasis: "测算表不表达合同立场",
              statedTotals: [],
              sheetTotalCount: found.length,
              error: null,
            });
            continue;
          }

          const parties = extractContractParties({
            sourceRecordId: "dossier-review",
            document: parsed.document,
          });
          const stance = inferContractStance({ parties: parties.parties, ownOrganizationNames });
          const stated = readStatedTotals(parsed.document);
          artifacts.push({
            name: file.name,
            kind: "CONTRACT",
            stance: stance.stance,
            stanceBasis: stance.basis,
            statedTotals: stated.map((total) => ({ amount: total.amount, basis: total.basis })),
            sheetTotalCount: 0,
            error: null,
          });
          // Without a stance there is no side to compare against, and guessing
          // one would measure a revenue contract against what we pay a supplier.
          if (stance.stance === null) continue;
          for (const total of stated) {
            contracts.push({
              artifactName: file.name,
              blockId: total.blockId,
              amount: total.amount,
              stance: stance.stance,
              taxIncluded: total.taxIncluded,
            });
          }
        } catch (error) {
          artifacts.push({
            name: file.name,
            kind: "CONTRACT",
            stance: null,
            stanceBasis: "",
            statedTotals: [],
            sheetTotalCount: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const report = reviewAmountChain({ contracts, totals: sheetTotals });
      return {
        artifacts,
        sheetTotals,
        checked: report.checked,
        matched: report.matched.flatMap((result) =>
          result.status === "MATCHED"
            ? [{ contract: result.contract, matched: result.matched }]
            : [],
        ),
        mismatched: report.mismatched.flatMap((result) =>
          result.status === "MISMATCHED"
            ? [
                {
                  contract: result.contract,
                  nearest: result.nearest,
                  difference: result.difference,
                },
              ]
            : [],
        ),
        unchecked: report.unchecked.flatMap((result) =>
          result.status === "NO_CANDIDATE"
            ? [{ contract: result.contract, reason: result.reason }]
            : [],
        ),
        handEnteredTotals: report.handEnteredTotals,
      };
    },
    {
      body: t.Object({
        files: t.Files({ description: "同一项目卷宗内的多个文件（测算表 + 收入/支出合同）" }),
        ownOrganizationNames: t.Optional(
          t.String({
            description: "本方主体名称片段，逗号分隔；省略时用服务端 OWN_ORGANIZATION_NAMES",
          }),
        ),
      }),
      detail: {
        summary: "卷宗金额链核对",
        description:
          "对同一项目卷宗内的多个文件做跨文档金额一致性核对：测算表（`.xlsx`）提供两侧合计，合同（`.docx` / `.pdf`）提供载明总额，按合同立场把两者对上。\n\n" +
          "- 合计只认行首标签为合计/小计的行，或表格自身求和的行；侧别沿表头行向左继承分组限定词（如 `客户侧不含税单价` 之后的 `不含税总价` 属客户侧）。\n" +
          "- 合同总额有两种读法：正文大小写载明，或价格表中按税率自校验的不含税/含税金额对。读不出来时该合同不参与比对，而不是猜一个数。\n" +
          "- 立场决定比对哪一侧：收入合同对客户侧，支出合同对供应商侧。否则项目毛利会被报成金额不一致。\n" +
          "- `handEnteredTotals` 是表格没有用公式支撑的合计——不是错误，是没有算术为它背书的数字。\n" +
          "- **无状态**：不落库、不创建案件，同一组文件的结果只取决于文件内容。\n\n" +
          "状态码：`200` 已核对；`413` 单个文件超过 `MAX_UPLOAD_BYTES`；`422` 文件少于两个或类型不被支持。",
        tags: [openapiTags.auditCases],
      },
      response: { 200: amountChainSchema, 413: errorSchema, 422: errorSchema },
    },
  );
}
