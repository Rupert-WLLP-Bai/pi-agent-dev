#!/usr/bin/env python3
"""Extract plain text from docx / xlsx without third-party deps."""
import html
import re
import sys
import zipfile


def strip(xml: str) -> str:
    xml = xml.replace("</w:p>", "\n").replace("</w:tc>", " | ").replace("</w:tr>", "\n")
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
    xml = re.sub(r"<[^>]+>", "", xml)
    return html.unescape(xml)


def docx(path: str) -> None:
    with zipfile.ZipFile(path) as z:
        print(strip(z.read("word/document.xml").decode("utf-8", "ignore")))


def xlsx(path: str, max_rows: int) -> None:
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        shared = []
        if "xl/sharedStrings.xml" in names:
            raw = z.read("xl/sharedStrings.xml").decode("utf-8", "ignore")
            for si in re.findall(r"<si>(.*?)</si>", raw, re.S):
                shared.append(html.unescape(re.sub(r"<[^>]+>", "", si)))

        wb = z.read("xl/workbook.xml").decode("utf-8", "ignore")
        sheet_names = re.findall(r'<sheet[^>]*name="([^"]*)"', wb)
        print(f"### SHEETS: {sheet_names}")

        sheet_files = sorted(n for n in names if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        for idx, sf in enumerate(sheet_files):
            label = sheet_names[idx] if idx < len(sheet_names) else sf
            print(f"\n===== SHEET[{idx}] {label} ({sf}) =====")
            raw = z.read(sf).decode("utf-8", "ignore")
            rows = re.findall(r"<row[^>]*r=\"(\d+)\"[^>]*>(.*?)</row>", raw, re.S)
            shown = 0
            for rnum, body in rows:
                cells = []
                for cell in re.findall(r"<c\b([^>]*)>(.*?)</c>", body, re.S):
                    attrs, inner = cell
                    ref = re.search(r'r="([A-Z]+\d+)"', attrs)
                    ctype = re.search(r't="(\w+)"', attrs)
                    vm = re.search(r"<v>(.*?)</v>", inner, re.S)
                    fm = re.search(r"<f[^>]*>(.*?)</f>", inner, re.S)
                    if vm is None and fm is None:
                        continue
                    val = html.unescape(re.sub(r"<[^>]+>", "", vm.group(1))) if vm else ""
                    if ctype and ctype.group(1) == "s" and val.isdigit():
                        val = shared[int(val)] if int(val) < len(shared) else val
                    elif ctype and ctype.group(1) == "inlineStr":
                        val = html.unescape(re.sub(r"<[^>]+>", "", inner))
                    formula = f"  ={html.unescape(fm.group(1))}" if fm else ""
                    cells.append(f"{ref.group(1) if ref else '?'}={val!r}{formula}")
                if cells:
                    print(f"r{rnum}: " + " ; ".join(cells))
                    shown += 1
                if shown >= max_rows:
                    print("... (truncated)")
                    break


if __name__ == "__main__":
    kind, target = sys.argv[1], sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 60
    docx(target) if kind == "docx" else xlsx(target, limit)
