import { expect, test } from "bun:test";
import { parsePdf } from "./pdf-parser";

/**
 * Builds a minimal single-page PDF by hand (two text lines via the Tj
 * operator), which pdfjs-dist parses without any font embedding. This keeps
 * the test hermetic: no fixture file, no binary blob in git, no network.
 */
function buildPdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 72 700 Td ${lines
    .map((line, index) => `${index === 0 ? "" : "0 -20 Td "}(${line}) Tj`)
    .join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

test("extracts text lines as one block tagged with its page number", async () => {
  const blocks = await parsePdf(buildPdf(["ADVANCE PAYMENT 70%", "SECOND LINE TEXT"]));

  expect(blocks).toHaveLength(1);
  expect(blocks[0].text).toContain("ADVANCE PAYMENT 70%");
  expect(blocks[0].text).toContain("SECOND LINE TEXT");
  expect(blocks[0].page).toBe(1);
  expect(blocks[0].kind).toBe("paragraph");
});

test("separates blocks when the vertical gap exceeds the line spacing", async () => {
  // Three lines with an exaggerated 80pt jump in the middle: the content
  // stream below pushes line 3 far below line 2, which must split blocks.
  const content =
    "BT /F1 12 Tf 72 700 Td (LINE ONE) Tj 0 -20 Td (LINE TWO) Tj 0 -80 Td (LINE THREE) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  const blocks = await parsePdf(new TextEncoder().encode(pdf));

  expect(blocks.length).toBeGreaterThanOrEqual(2);
  expect(blocks[0].text).toContain("LINE ONE");
  expect(blocks[blocks.length - 1].text).toContain("LINE THREE");
});

test("the caller's bytes survive parsing, so a second reader still sees them", async () => {
  // pdfjs transfers whatever buffer it is handed. A scanned contract is read
  // twice — text layer first, then OCR — so parsing must not detach the input.
  const data = buildPdf(["ADVANCE PAYMENT 70%"]);
  const byteLength = data.byteLength;

  await parsePdf(data);

  expect(data.byteLength).toBe(byteLength);
  const again = await parsePdf(data);
  expect(again[0].text).toContain("ADVANCE PAYMENT 70%");
});

test("returns no blocks for a PDF without text content", async () => {
  const content = "BT /F1 12 Tf 72 700 Td ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  const blocks = await parsePdf(new TextEncoder().encode(pdf));
  expect(blocks).toEqual([]);
});
