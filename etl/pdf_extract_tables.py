# -*- coding: utf-8 -*-
"""Извлечь таблицы из PDF в CSV (UTF-8) для дальнейшего ETL."""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

_ETL = Path(__file__).resolve().parent
if str(_ETL) not in sys.path:
    sys.path.insert(0, str(_ETL))

from io_utils import extract_pdf_tables


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("-o", "--out-dir", type=Path, default=Path("pdf_tables_out"))
    args = ap.parse_args()
    tables = extract_pdf_tables(args.pdf)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for i, tbl in enumerate(tables):
        out = args.out_dir / f"table_{i+1}.csv"
        with out.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f, delimiter=";")
            for row in tbl:
                w.writerow(row)
        print(out)
    print(f"OK: {len(tables)} таблиц")


if __name__ == "__main__":
    main()
