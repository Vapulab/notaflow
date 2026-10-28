"""One-time converter: Anexo VIII xlsx (sheet "tabela geral") to src/rules/anexo8.json.

Usage: python scripts/anexo8.py <anexo8.xlsx> [out.json]
Needs openpyxl. Not run in CI; it records how the JSON was made.
"""
import json
import sys
from pathlib import Path

import openpyxl

SHEET = "tabela geral"
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "rules" / "anexo8.json"


def code6(value):
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text.zfill(6) if text.isdigit() and len(text) <= 6 else None


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    ws = openpyxl.load_workbook(src, read_only=True, data_only=True)[SHEET]
    rows = ws.iter_rows(values_only=True)
    header = [str(c).strip() if c is not None else "" for c in next(rows)]
    col = {name: i for i, name in enumerate(header)}
    item_i, indop_i, class_i = col["Item LC 116"], col["INDOP"], col["cClassTrib"]

    items = {}
    current = None
    for row in rows:
        if row[item_i] is not None and str(row[item_i]).strip():
            current = str(row[item_i]).strip().replace(".", "")
            items.setdefault(current, {})
        if current is None:
            continue
        entry = items[current]
        # First INDOP and first cClassTrib only: later rows are special regimes.
        if "operationCode" not in entry and code6(row[indop_i]):
            entry["operationCode"] = code6(row[indop_i])
        if "classCode" not in entry and code6(row[class_i]):
            entry["classCode"] = code6(row[class_i])

    # Keys that are not LC 116 items (e.g. 99.02.01) do not fit the 4-digit cTribNac prefix.
    complete = {k: v for k, v in sorted(items.items()) if len(v) == 2 and len(k) == 4}
    for key in sorted(set(items) - set(complete)):
        print(f"skipped (incomplete, uses the fallback): {key} {items[key]}", file=sys.stderr)
    out.write_text(json.dumps(complete, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(complete)} items written to {out}")


if __name__ == "__main__":
    main()
