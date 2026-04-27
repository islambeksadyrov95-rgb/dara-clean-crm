"""
Собирает все CSV «Временной_ряд» из папок маркетинг/Google (Сентябрь … Февраль)
в одну таблицу по дням: дата, клики, показы, расход, ср. цена за клик (если есть).
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ETL = ROOT / "etl"
for p in (ETL, ROOT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from marketing_google_timeseries import parse_google_timeseries_csv  # noqa: E402


MONTH_FOLDERS = (
    "Сентябрь",
    "Октбярь",
    "Ноябрь",
    "Декабрь",
    "Январь",
    "Февраль",
)


def collect_csv_paths(base: Path) -> list[Path]:
    paths: list[Path] = []
    for name in MONTH_FOLDERS:
        d = base / name
        if not d.is_dir():
            continue
        for p in sorted(d.glob("Временной_ряд*.csv")):
            paths.append(p)
    return sorted(paths)


def merge_daily(base: Path) -> list[dict]:
    """Одна строка на дату; при дубликатах — суммируем числовые поля."""
    by_date: dict[str, dict] = {}
    for csv_path in collect_csv_paths(base):
        rows = parse_google_timeseries_csv(csv_path)
        for r in rows:
            d = r["date"]
            clicks = int(r.get("clicks") or 0)
            imp = int(r.get("impressions") or 0)
            spend = float(r.get("spend") or 0)
            if d not in by_date:
                by_date[d] = {
                    "date": d,
                    "clicks": clicks,
                    "impressions": imp,
                    "spend": spend,
                }
            else:
                cur = by_date[d]
                cur["clicks"] += clicks
                cur["impressions"] += imp
                cur["spend"] += spend
    out = sorted(by_date.values(), key=lambda x: x["date"])
    for row in out:
        c = row["clicks"]
        row["avg_cpc"] = round(row["spend"] / c, 4) if c else 0.0
    return out


def write_csv(rows: list[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["date", "clicks", "impressions", "spend", "avg_cpc"]
    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in fieldnames})


def write_xlsx(rows: list[dict], out_path: Path) -> None:
    try:
        from openpyxl import Workbook
    except ImportError:
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "Google daily"
    headers = ["date", "clicks", "impressions", "spend", "avg_cpc"]
    ws.append(headers)
    for r in rows:
        ws.append([r[h] for h in headers])
    wb.save(out_path)


def main() -> int:
    ap = argparse.ArgumentParser(description="Объединить Временной_ряд CSV Google по дням")
    ap.add_argument(
        "--base",
        type=Path,
        default=ROOT / "маркетинг" / "Google",
        help="Папка с подпапками месяцев",
    )
    ap.add_argument(
        "--out-csv",
        type=Path,
        default=ROOT / "маркетинг" / "Google" / "google_timeseries_daily_сент_фев.csv",
    )
    ap.add_argument(
        "--out-xlsx",
        type=Path,
        default=ROOT / "маркетинг" / "Google" / "google_timeseries_daily_сент_фев.xlsx",
    )
    args = ap.parse_args()
    rows = merge_daily(args.base)
    write_csv(rows, args.out_csv)
    write_xlsx(rows, args.out_xlsx)
    print(f"Строк: {len(rows)} -> {args.out_csv}")
    if args.out_xlsx.exists():
        print(f"XLSX: {args.out_xlsx}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
