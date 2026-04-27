# -*- coding: utf-8 -*-
"""Сборка dashboard-data.json из sales.json, finance.json, маркетинговых CSV."""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

_ETL = Path(__file__).resolve().parent
if str(_ETL) not in sys.path:
    sys.path.insert(0, str(_ETL))

from fx_usd_kzt import load_rates
from marketing_google_timeseries import parse_google_timeseries_csv
from sales_from_sheet import load_sales
from two_gis_connections import TWO_GIS_METRIC_KEYS

YANDEX_SKIP_NAMES = frozenset(
    {
        "yandex_metrica_daily_template.csv",
    }
)


def _dedup_marketing_daily(rows: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[str]]:
    """
    Агрегация по (date, channel): суммы метрик. Политика: суммирование перекрывающихся выгрузок.
    """
    warnings: List[str] = []
    buckets: Dict[tuple, Dict[str, Any]] = {}
    order: List[tuple] = []
    for r in rows:
        k = (r.get("date", ""), r.get("channel", ""))
        if k not in buckets:
            order.append(k)
            b0: Dict[str, Any] = {
                "date": r.get("date"),
                "channel": r.get("channel"),
                "channelLabel": r.get("channelLabel"),
                "spend": 0.0,
                "spendCurrency": r.get("spendCurrency") or "KZT",
                "spendUsd": 0.0,
                "spendKzt": 0.0,
                "impressions": 0,
                "clicks": 0,
                "leads": 0,
                "contactsAfterSale": 0,
                "applicationsOut": 0,
            }
            for _gk in TWO_GIS_METRIC_KEYS:
                b0[_gk] = 0
            buckets[k] = b0
        b = buckets[k]
        sk = r.get("spendKzt")
        if sk is None:
            sk = r.get("spend") or 0
        sk = float(sk)
        b["spend"] += sk
        b["spendKzt"] += sk
        b["spendUsd"] += float(r.get("spendUsd") or 0)
        b["impressions"] += int(r.get("impressions") or 0)
        b["clicks"] += int(r.get("clicks") or 0)
        b["leads"] += int(r.get("leads") or 0)
        b["contactsAfterSale"] += int(r.get("contactsAfterSale") or 0)
        b["applicationsOut"] += int(r.get("applicationsOut") or 0)
        for _gk in TWO_GIS_METRIC_KEYS:
            b[_gk] = int(b.get(_gk) or 0) + int(r.get(_gk) or 0)
    out = [buckets[k] for k in order]
    dup_count = len(rows) - len(out)
    if dup_count > 0:
        warnings.append(f"marketingDaily: сжато дублей date+channel: {dup_count}")
    return out, warnings


def _source_ranges(
    marketing: List[Dict[str, Any]],
    transactions: List[Dict[str, Any]],
    plans_daily: List[Dict[str, Any]],
    dds_reports: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    def mm(dates: List[str]) -> Optional[Dict[str, str]]:
        ok = [d for d in dates if d and len(d) >= 10]
        if not ok:
            return None
        s = sorted(ok)
        return {"min": s[0][:10], "max": s[-1][:10]}

    md = [m.get("date", "") for m in marketing]
    td = [t.get("date", "") for t in transactions]
    pd = [p.get("date", "") for p in plans_daily]
    out_sr: Dict[str, Any] = {
        "marketingDaily": mm(md),
        "transactions": mm(td),
        "plansDaily": mm(pd),
    }
    keys: List[str] = []
    for rep in dds_reports or []:
        for sec in ("incomeItogo", "expenseItogo"):
            part = rep.get(sec)
            if part and isinstance(part, dict):
                keys.extend((part.get("byMonth") or {}).keys())
    ok_k = sorted({k for k in keys if k and len(k) >= 7})
    if ok_k:
        out_sr["dds"] = {"min": ok_k[0], "max": ok_k[-1]}
    return out_sr


def _deep_merge(
    base: Dict[str, Any],
    sales: Optional[Dict[str, Any]],
    finance: Optional[Dict[str, Any]],
    marketing_rows: Optional[List[Dict[str, Any]]],
    sales_note: Optional[str] = None,
) -> Dict[str, Any]:
    out = dict(base)
    out["meta"] = {
        "currency": "KZT",
        "source": "merged",
        "mergedFrom": ["sales", "finance", "marketing"],
    }
    if sales_note:
        out["meta"]["salesSource"] = "none"
        out["meta"]["salesNote"] = sales_note
    if sales:
        out["clients"] = sales.get("clients") or []
        out["managers"] = sales.get("managers") or []
        out["products"] = sales.get("products") or []
        out["transactions"] = sales.get("transactions") or []
    else:
        out["clients"] = []
        out["managers"] = []
        out["products"] = []
        out["transactions"] = []
    if finance:
        out["plans"] = finance.get("plans") or {"daily": [], "funnel": {}}
        if "lossReasons" in finance:
            out["lossReasons"] = finance["lossReasons"]
    else:
        out.setdefault("plans", {"daily": [], "funnel": {}})
    if marketing_rows:
        out["marketingDaily"] = marketing_rows
    else:
        out.setdefault("marketingDaily", [])
    out.setdefault("funnelSnapshots", [])
    out.setdefault("funnelStages", ["lead", "contact", "dialog", "deal", "payment"])
    out.setdefault("lossReasons", [])
    if finance:
        out["dds"] = finance.get("dds") or []
        out["financePayrollDaily"] = finance.get("financePayrollDaily") or []
    else:
        out.setdefault("dds", [])
        out.setdefault("financePayrollDaily", [])
    return out


def _build_funnel_snapshots_from_transactions(transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    from collections import defaultdict

    by_date: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in transactions:
        d = t.get("date")
        if not d:
            continue
        fs = t.get("funnelStage") or "payment"
        st = t.get("status")
        if st == "lost":
            continue
        by_date[d][fs] = by_date[d].get(fs, 0) + 1
    out = []
    for d in sorted(by_date.keys()):
        m = by_date[d]
        out.append(
            {
                "date": d,
                "lead": m.get("lead", 0),
                "contact": m.get("contact", 0),
                "dialog": m.get("dialog", 0),
                "deal": m.get("deal", 0),
                "payment": m.get("payment", 0),
            }
        )
    return out


def merge(
    sales_path: Optional[Path],
    finance_path: Optional[Path],
    google_csv_glob: str,
    out_path: Path,
    two_gis_path: Optional[Path] = None,
    yandex_dir: Optional[Path] = None,
    finance_sheet: Union[int, str] = 0,
    loss_sheet: Union[int, str] = 1,
    finance_header_row: int = 0,
    sales_sheet: Union[int, str] = 0,
    sales_header_row: int = 0,
) -> None:
    sales = None
    if sales_path and sales_path.exists():
        sales = load_sales(sales_path, sheet=sales_sheet, header_row=sales_header_row)
    finance = None
    if finance_path and finance_path.exists():
        from finance_dds import load_finance_extensions
        from finance_workbook import load_finance_plans, load_loss_reasons_from_sheet

        finance = load_finance_plans(finance_path, sheet=finance_sheet, header_row=finance_header_row)
        lr = load_loss_reasons_from_sheet(finance_path, sheet=loss_sheet)
        if lr:
            finance["lossReasons"] = lr
        fe = load_finance_extensions(finance_path)
        for k, v in fe.items():
            if v:
                finance[k] = v

    rates = load_rates()
    fx_warnings: List[str] = []
    mkt: List[Dict[str, Any]] = []
    base = Path(google_csv_glob)
    if base.is_dir():
        for f in sorted(base.rglob("Временной_ряд*.csv")):
            mkt.extend(parse_google_timeseries_csv(f, fx_warnings=fx_warnings, rates=rates))
    elif base.exists():
        mkt.extend(parse_google_timeseries_csv(base, fx_warnings=fx_warnings, rates=rates))

    if two_gis_path and two_gis_path.exists():
        from two_gis_connections import parse_two_gis_xlsx

        mkt.extend(parse_two_gis_xlsx(two_gis_path))

    skipped_yandex: List[Dict[str, str]] = []
    if yandex_dir and Path(yandex_dir).is_dir():
        from marketing_yandex_metrica import parse_yandex_metrica_csv

        for f in sorted(Path(yandex_dir).resolve().rglob("*.csv")):
            name_l = f.name.lower()
            if name_l in YANDEX_SKIP_NAMES or "template" in name_l:
                continue
            try:
                mkt.extend(parse_yandex_metrica_csv(f))
            except ValueError as e:
                skipped_yandex.append({"file": str(f), "error": str(e)})

    mkt, dedup_warn = _dedup_marketing_daily(mkt)
    all_warnings = fx_warnings + dedup_warn

    note = None
    if not sales_path or not sales_path.exists():
        note = (
            "Сделки не загружены: источник продаж — только PDF (гистограмма), "
            "помесячные строки сделок недоступны. Для полного блока продаж выгрузите Excel/CSV из CRM."
        )
    merged = _deep_merge({}, sales, finance, mkt if mkt else None, sales_note=note)
    if sales and (sales.get("meta") or {}).get("pivotSource"):
        merged["meta"]["salesPivotSynthesized"] = True
    if finance and (finance.get("meta") or {}).get("monthSheets"):
        merged["meta"]["financeMonthSheets"] = finance["meta"]["monthSheets"]
    if merged.get("transactions"):
        merged["funnelSnapshots"] = _build_funnel_snapshots_from_transactions(merged["transactions"])

    plans_daily = (merged.get("plans") or {}).get("daily") or []
    merged["meta"]["buildTime"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    merged["meta"]["sourceRanges"] = _source_ranges(
        merged.get("marketingDaily") or [],
        merged.get("transactions") or [],
        plans_daily,
        merged.get("dds") or [],
    )
    merged["meta"]["warnings"] = all_warnings
    merged["meta"]["skippedYandexFiles"] = skipped_yandex
    merged["meta"]["assumptions"] = {
        "googleSpendOriginalCurrency": "USD",
        "googleSpendAnalyticsKzt": True,
        "fxSource": str((_ETL / "data" / "nbrk_usd_kzt.json").resolve()),
        "marketingDedup": "sum_by_date_and_channel",
    }
    if fx_warnings:
        merged["meta"]["assumptions"]["fxWarningsCount"] = len(fx_warnings)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
    print(f"Written {out_path} ({len(merged.get('transactions') or [])} tx, {len(merged.get('marketingDaily') or [])} mkt)")


def main():
    import argparse

    ap = argparse.ArgumentParser(description="Сборка dashboard-data.json")
    ap.add_argument("--sales", type=Path, help="CSV/XLSX продаж")
    ap.add_argument("--finance", type=Path, help="xlsx финансов")
    ap.add_argument("--google", type=str, default="", help="Папка маркетинг/Google или один CSV Временной_ряд")
    ap.add_argument("--two-gis", type=Path, default=None, help="xlsx выгрузки 2GIS (connections-daily и т.п.)")
    ap.add_argument(
        "--yandex",
        type=Path,
        default=None,
        help="Папка с CSV Яндекс.Метрики (визиты по дням и т.п.) — все *.csv рекурсивно",
    )
    ap.add_argument(
        "--finance-sheet",
        default="0",
        help="Имя листа или индекс (0) для плана по дням в xlsx финансов",
    )
    ap.add_argument(
        "--loss-sheet",
        default="1",
        help="Имя листа или индекс для причин потерь (по умолчанию 1)",
    )
    ap.add_argument(
        "--finance-header-row",
        type=int,
        default=0,
        help="Строка заголовков в xlsx финансов (0 = первая строка; для «Октябрь» обычно авто)",
    )
    ap.add_argument(
        "--sales-sheet",
        default="0",
        help="Индекс или имя листа Excel продаж",
    )
    ap.add_argument(
        "--sales-header-row",
        type=int,
        default=0,
        help="Строка заголовков в файле продаж",
    )
    ap.add_argument("-o", "--out", type=Path, default=Path("../dashboard/data/dashboard-data.json"))
    args = ap.parse_args()
    g = str(Path(args.google).resolve()) if args.google else ""

    def _sheet_arg(s: str) -> Union[int, str]:
        s = str(s).strip()
        if s.isdigit():
            return int(s)
        return s

    merge(
        args.sales,
        args.finance,
        g,
        args.out.resolve(),
        args.two_gis,
        yandex_dir=args.yandex,
        finance_sheet=_sheet_arg(args.finance_sheet),
        loss_sheet=_sheet_arg(args.loss_sheet),
        finance_header_row=args.finance_header_row,
        sales_sheet=_sheet_arg(args.sales_sheet),
        sales_header_row=args.sales_header_row,
    )


if __name__ == "__main__":
    main()
