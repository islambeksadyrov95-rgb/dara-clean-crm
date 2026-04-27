# -*- coding: utf-8 -*-
"""Быстрая проверка листов и заголовков xlsx перед merge_build."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ETL = Path(__file__).resolve().parent
if str(_ETL) not in sys.path:
    sys.path.insert(0, str(_ETL))

from io_utils import read_excel_sheet


def _preview(path: Path, sheet: int | str, max_rows: int = 4) -> None:
    print(f"\n=== {path.name} sheet={sheet!r} ===")
    try:
        rows = read_excel_sheet(path, sheet)
    except Exception as e:
        print(f"  ERROR: {e}")
        return
    print(f"  rows: {len(rows)}")
    for i, r in enumerate(rows[:max_rows]):
        head = [str(c)[:40] for c in (r[:12] if r else [])]
        print(f"  [{i}] {head}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Preflight: листы Excel")
    ap.add_argument("--sales", type=Path, help="xlsx продаж")
    ap.add_argument("--finance", type=Path, help="xlsx финансов")
    ap.add_argument("--sales-sheet", default=0)
    ap.add_argument("--finance-sheet", default=0)
    args = ap.parse_args()

    def sheet_arg(s: str):
        s = str(s).strip()
        return int(s) if s.isdigit() else s

    if args.sales and args.sales.exists():
        _preview(args.sales, sheet_arg(args.sales_sheet))
    if args.finance and args.finance.exists():
        _preview(args.finance, sheet_arg(args.finance_sheet))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
