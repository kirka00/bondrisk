"""Минимальный разбор xlsx (zipfile + xml), без openpyxl: shared strings и inline strings."""

from __future__ import annotations

import html
import re
import zipfile
from io import BytesIO


def xlsx_rows(data: bytes, sheet_index: int = 0) -> list[dict[str, str]]:
    """Строки листа как словари {буква колонки: значение}; пустые строки пропускаются."""
    z = zipfile.ZipFile(BytesIO(data))
    ss: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        ss = [
            html.unescape(re.sub(r"<[^>]+>", "", x))
            for x in re.findall(
                r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode("utf-8", "ignore"), re.S
            )
        ]
    sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n))
    xml = z.read(sheets[sheet_index]).decode("utf-8", "ignore")
    out: list[dict[str, str]] = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
        cells: dict[str, str] = {}
        for attrs, inner in re.findall(r"<c ([^>]*)>(.*?)</c>", row, re.S):
            ref = re.search(r'r="([A-Z]+)\d+"', attrs)
            typ = re.search(r't="(\w+)"', attrs)
            if not ref:
                continue
            inline = re.search(r"<t[^>]*>([^<]*)</t>", inner)
            v = re.search(r"<v>([^<]*)</v>", inner)
            if typ and typ.group(1) == "inlineStr" and inline:
                val = html.unescape(inline.group(1))
            elif typ and typ.group(1) == "s" and v:
                val = ss[int(v.group(1))]
            elif v:
                val = v.group(1)
            else:
                continue
            cells[ref.group(1)] = val
        if cells:
            out.append(cells)
    return out
