# -*- coding: utf-8 -*-
"""
Яндекс.Метрика: CSV «по дням» (визиты, посетители, опц. конверсии).
Расход рекламы в отчёте Метрики часто нет — spend=0, визиты кладём в clicks для графиков.
При наличии колонки «Расходы» / Direct — сумма в spend, spendCurrency=RUB по умолчанию.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from excel_dates import cell_to_iso
from parse_kzt import parse_amount


def _norm(h: str) -> str:
    return str(h or "").strip().strip("\ufeff").lower().replace("ё", "е")


def _find_col(header: List[Union[str, Any]], *keywords: str) -> int:
    for i, h in enumerate(header):
        hn = _norm(h)
        for kw in keywords:
            if kw in hn:
                return i
    return -1


def _parse_date_cell(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip().strip('"')
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}"
    ds = cell_to_iso(raw)
    if len(ds) >= 10 and ds[4] == "-":
        return ds[:10]
    return None


def _find_header_row(rows: List[List[str]]) -> int:
    for i, r in enumerate(rows[:25]):
        for c in r:
            if "дата" in _norm(str(c)) or _norm(str(c)) == "date":
                return i
    return 0


def parse_yandex_metrica_csv(path: Path) -> List[Dict[str, Any]]:
    from io_utils import read_csv_rows

    rows = read_csv_rows(path)
    if not rows:
        return []
    hr = _find_header_row(rows)
    header = [str(c or "").strip().strip("\ufeff") for c in rows[hr]]
    i_date = _find_col(header, "дата", "date", "период")
    i_visits = _find_col(header, "визит", "visit", "сесс", "session")
    i_users = _find_col(header, "посетител", "user", "уникал", "уникальн")
    i_spend = _find_col(header, "расход", "cost", "списан", "direct")
    i_conv = _find_col(header, "конверс", "достижен", "цель", "goal", "заказ")

    if i_date < 0:
        raise ValueError(f"Яндекс CSV: нет колонки даты в {path}")

    metric_col = i_visits if i_visits >= 0 else i_users
    if metric_col < 0:
        raise ValueError(f"Яндекс CSV: нужны «Визиты» или «Посетители» в {path}")

    out: List[Dict[str, Any]] = []
    for r in rows[hr + 1 :]:
        if i_date >= len(r):
            continue
        iso = _parse_date_cell(r[i_date])
        if not iso:
            continue
        visits = int(float(parse_amount(r[metric_col] if metric_col < len(r) else 0)))
        if visits < 0:
            visits = 0
        spend = 0.0
        spend_cur = "KZT"
        if i_spend >= 0 and i_spend < len(r) and r[i_spend] not in (None, ""):
            spend = parse_amount(r[i_spend])
            cell = str(r[i_spend]).lower()
            if "₽" in cell or "руб" in cell or "rub" in cell:
                spend_cur = "RUB"
        leads = 1
        if i_conv >= 0 and i_conv < len(r) and r[i_conv] not in (None, ""):
            leads = max(1, int(float(parse_amount(r[i_conv]))))
        elif visits:
            leads = max(1, visits // 50)

        out.append(
            {
                "date": iso,
                "channel": "yandex",
                "channelLabel": "Яндекс Метрика",
                "spend": spend,
                "spendCurrency": spend_cur,
                "impressions": visits * 2,
                "clicks": visits,
                "leads": leads,
                "contactsAfterSale": 0,
                "applicationsOut": 0,
            }
        )
    return out
