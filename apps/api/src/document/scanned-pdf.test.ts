import { expect, test } from "bun:test";
import { buildTextlessPdf, FakeOcrPort } from "../testing/fakes";
import { parseContractFile, ScannedPdfNotRecognizedError } from "./index";

test("a PDF with no text layer is recognized, and the blocks keep their page numbers", async () => {
  const ocr = new FakeOcrPort([
    { page: 1, index: 0, text: "第一条 服务内容" },
    { page: 1, index: 1, text: "乙方向甲方提供大数据服务，服务费为人民币 120,000.00 元。" },
    { page: 2, index: 0, text: "第二条 付款方式：合同签订后 30 日内支付 70%。" },
  ]);

  const parsed = await parseContractFile(
    { filename: "扫描合同.pdf", data: buildTextlessPdf(2) },
    ocr,
  );

  expect(ocr.calls).toBe(1);
  expect(parsed.text).toContain("120,000.00");
  expect(parsed.text).toContain("支付 70%");
  // The page number is what an Evidence Locator anchors to, so it must survive
  // the trip through the IR builder.
  const payment = parsed.document.blocks.find((block) => block.text.includes("第二条"));
  expect(payment?.page).toBe(2);
  expect(parsed.document.blocks[0].page).toBe(1);
  expect(parsed.ocr).toEqual({
    engine: "fake:test",
    pagesRead: 2,
    pageCount: 2,
    degradedPages: [],
  });
});

test("pages the recognizer could not finish are surfaced, not silently dropped", async () => {
  const ocr = new FakeOcrPort([{ page: 1, index: 0, text: "第一条 服务内容" }], true, [2, 3]);

  const parsed = await parseContractFile(
    { filename: "扫描合同.pdf", data: buildTextlessPdf(1) },
    ocr,
  );

  expect(parsed.ocr?.degradedPages).toEqual([2, 3]);
});

test("a scanned PDF with recognition off fails with the reason, not as an empty contract", async () => {
  const ocr = new FakeOcrPort([], false);

  const attempt = parseContractFile({ filename: "扫描合同.pdf", data: buildTextlessPdf() }, ocr);

  await expect(attempt).rejects.toBeInstanceOf(ScannedPdfNotRecognizedError);
  await expect(attempt).rejects.toThrow("假实现已关闭");
  expect(ocr.calls).toBe(0);
});

test("a recognizer that returns nothing is a recognition failure, not a silent pass", async () => {
  const ocr = new FakeOcrPort([]);

  const attempt = parseContractFile({ filename: "扫描合同.pdf", data: buildTextlessPdf() }, ocr);

  await expect(attempt).rejects.toBeInstanceOf(ScannedPdfNotRecognizedError);
  expect(ocr.calls).toBe(1);
});

test("a PDF that already has a text layer never reaches the recognizer", async () => {
  const content = "BT /F1 12 Tf 72 700 Td (SERVICE FEE 120000) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  const ocr = new FakeOcrPort([{ page: 1, index: 0, text: "不应被使用" }]);
  const parsed = await parseContractFile(
    { filename: "数字合同.pdf", data: new TextEncoder().encode(pdf) },
    ocr,
  );

  expect(ocr.calls).toBe(0);
  expect(parsed.ocr).toBeUndefined();
  expect(parsed.text).toContain("SERVICE FEE 120000");
});

test("a pasted text contract never reaches the recognizer even when one is wired", async () => {
  const ocr = new FakeOcrPort([{ page: 1, index: 0, text: "不应被使用" }]);

  const parsed = await parseContractFile(
    {
      filename: "合同.txt",
      data: new TextEncoder().encode("第一条 服务内容\n\n服务费 120,000.00 元"),
    },
    ocr,
  );

  expect(ocr.calls).toBe(0);
  expect(parsed.ocr).toBeUndefined();
  expect(parsed.text).toContain("120,000.00");
});
