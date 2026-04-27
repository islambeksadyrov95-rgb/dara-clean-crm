# -*- coding: utf-8 -*-
"""
2GIS / рекламные выгрузки: колонки дата + расход/клики (поиск по заголовкам).
Выход: marketingDaily с channel=2gis.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union

_ETL = Path(__file__).resolve().parent
if str(_ETL) not in sys.path:
    sys.path.insert(0, str(_ETL))

from date_parse import parse_to_iso
from io_utils import read_excel_sheet, rows_to_records
from parse_kzt import parse_amount


def _norm(h: str) -> str:
    return str(h or "").strip().lower().replace("ё", "е")


# Ключи JSON для колонок выгрузки «Период» + метрики (лист Tables и т.п.)
TWO_GIS_METRIC_KEYS: Tuple[str, ...] = (
    "twoGisCallsPhoneViews",
    "twoGisAddressClicks",
    "twoGisWebsiteVisits",
    "twoGisRouteBuilds",
    "twoGisSocialClicks",
    "twoGisMessengerClicks",
    "twoGisAdLinkClicks",
)


def _header_to_two_gis_key(header_cell: str) -> str:
    """Сопоставление заголовка колонки 2GIS стабильному полю (устойчиво к формулировкам)."""
    n = _norm(header_cell)
    if not n:
        return ""
    if "звонк" in n and "телефон" in n:
        return "twoGisCallsPhoneViews"
    if "клик" in n and "адрес" in n:
        return "twoGisAddressClicks"
    if "переход" in n and "сайт" in n:
        return "twoGisWebsiteVisits"
    if "маршрут" in n:
        return "twoGisRouteBuilds"
    if "соцсет" in n:
        return "twoGisSocialClicks"
    if "мессенджер" in n:
        return "twoGisMessengerClicks"
    if "реклам" in n and "ссылк" in n:
        return "twoGisAdLinkClicks"
    return ""


def find_col(headers: List[str], *keywords: str) -> int:
    low = [_norm(h) for h in headers]
    for i, h in enumerate(low):
        for kw in keywords:
            if kw in h:
                return i
    return -1


def _parse_two_gis_period_layout(rows: List[List[Any]]) -> List[Dict[str, Any]]:
    """Выгрузка 2GIS: строка с «Период» в колонке B, даты с колонки B, метрики — числа (без бюджета в ₸)."""
    hi = -1
    for i, r in enumerate(rows[:40]):
        if len(r) > 1 and str(r[1] or "").strip() == "Период":
            hi = i
            break
    if hi < 0:
        return []
    header_row = rows[hi]
    col_to_key: Dict[int, str] = {}
    for j in range(2, min(len(header_row), 24)):
        k = _header_to_two_gis_key(str(header_row[j] or ""))
        if k:
            col_to_key[j] = k
    out: List[Dict[str, Any]] = []
    for r in rows[hi + 1 :]:
        if len(r) < 3:
            continue
        ds = parse_to_iso(r[1])
        if len(ds) < 10:
            continue
        vals = {k: 0 for k in TWO_GIS_METRIC_KEYS}
        if col_to_key:
            for j, key in col_to_key.items():
                if j >= len(r):
                    continue
                c = r[j]
                if c is None or str(c).strip() == "":
                    continue
                try:
                    vals[key] += int(float(str(c).replace(" ", "").replace(",", ".")))
                except (ValueError, TypeError):
                    continue
            clicks = int(sum(vals.values()))
        else:
            clicks = 0
            for c in r[2:12]:
                if c is None or str(c).strip() == "":
                    continue
                try:
                    clicks += int(float(str(c).replace(" ", "").replace(",", ".")))
                except (ValueError, TypeError):
                    continue
        out.append(
            {
                "date": ds[:10],
                "channel": "2gis",
                "channelLabel": "2GIS",
                "spend": 0.0,
                "spendCurrency": "KZT",
                "impressions": 0,
                "clicks": clicks,
                "leads": 0,
                "contactsAfterSale": 0,
                "applicationsOut": 0,
                **vals,
            }
        )
    return out


def parse_two_gis_xlsx(path: Union[str, Path], sheet: Union[int, str] = 0) -> List[Dict[str, Any]]:
    rows = read_excel_sheet(path, sheet)
    if not rows or len(rows) < 2:
        return []
    period = _parse_two_gis_period_layout(rows)
    if period:
        return period
    headers = [str(c or "") for c in rows[0]]
    i_date = find_col(headers, "дата", "date", "день", "период")
    i_spend = find_col(headers, "расход", "списан", "стоим", "budget", "cost")
    i_clicks = find_col(headers, "клик", "click", "визит")
    i_imp = find_col(headers, "показ", "показы", "impression")

    out: List[Dict[str, Any]] = []

    if i_date < 0:
        recs = rows_to_records(rows, 0)
        for r in recs:
            keys = {_norm(k): v for k, v in r.items()}
            d = None
            for k in ("дата", "date", "день"):
                if k in keys and keys[k] is not None:
                    d = keys[k]
                    break
            if d is None:
                continue
            ds = parse_to_iso(d)
            if len(ds) < 10:
                continue
            sp = parse_amount(keys.get("расходы") or keys.get("расход") or keys.get("сумма") or 0)
            cl = int(parse_amount(keys.get("клики") or keys.get("клик") or 0))
            out.append(
                {
                    "date": ds[:10],
                    "channel": "2gis",
                    "channelLabel": "2GIS",
                    "spend": sp,
                    "spendCurrency": "KZT",
                    "impressions": int(parse_amount(keys.get("показы") or keys.get("показ") or cl * 15)),
                    "clicks": cl or max(1, int(sp / 50) if sp else 1),
                    "leads": max(1, cl // 5) if cl else 1,
                    "contactsAfterSale": 0,
                    "applicationsOut": 0,
                }
            )
        return out

    for r in rows[1:]:
        if i_date >= len(r) or r[i_date] is None or str(r[i_date]).strip() == "":
            continue
        ds = parse_to_iso(r[i_date])
        if len(ds) < 10:
            continue
        spend = parse_amount(r[i_spend]) if i_spend >= 0 and i_spend < len(r) else 0.0
        clicks = int(parse_amount(r[i_clicks])) if i_clicks >= 0 and i_clicks < len(r) else max(1, int(spend / 40) if spend else 1)
        imp = int(parse_amount(r[i_imp])) if i_imp >= 0 and i_imp < len(r) else clicks * 12
        out.append(
            {
                "date": ds[:10],
                "channel": "2gis",
                "channelLabel": "2GIS",
                "spend": spend,
                "spendCurrency": "KZT",
                "impressions": imp,
                "clicks": clicks,
                "leads": max(1, clicks // 6),
                "contactsAfterSale": 0,
                "applicationsOut": 0,
            }
        )
    return out


if __name__ == "__main__":
    p = Path(sys.argv[1])
    rows = parse_two_gis_xlsx(p)
    print(json.dumps(rows[:5], ensure_ascii=False, indent=2))
    print("rows:", len(rows))
