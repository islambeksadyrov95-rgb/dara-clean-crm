# -*- coding: utf-8 -*-
"""
Google Ads «Временной_ряд»: колонки Дата, Клики, Показы, Расходы (USD в кабинете).
В JSON: spend и spendKzt — сумма в тенге (USD × курс НБ из etl/data/nbrk_usd_kzt.json),
spendUsd — исходный расход, spendCurrency=KZT для сопоставления с выручкой.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from parse_kzt import parse_amount

from fx_usd_kzt import load_rates, usd_to_kzt

# Русские дни: «вс, 1 февр. 2026 г.» — грубый разбор через regex + год/месяц из имени файла
_RE_DATE = re.compile(r"(\d{1,2})\s+([а-яё]+)\.?\s+(\d{4})")


_MONTHS_RU = {
    "янв": 1,
    "февр": 2,
    "мар": 3,
    "апр": 4,
    "мая": 5,
    "мае": 5,
    "июн": 6,
    "июл": 7,
    "авг": 8,
    "сен": 9,
    "окт": 10,
    "ноя": 11,
    "дек": 12,
}


def _parse_russian_date(cell: str, fallback_year_month: Optional[tuple] = None) -> Optional[str]:
    s = (cell or "").strip().strip('"')
    m = _RE_DATE.search(s.lower())
    if not m:
        return None
    day = int(m.group(1))
    mon_s = m.group(2)[:4]
    year = int(m.group(3))
    month = None
    for k, v in _MONTHS_RU.items():
        if mon_s.startswith(k[:3]):
            month = v
            break
    if month is None and fallback_year_month:
        year, month = fallback_year_month[0], fallback_year_month[1]
    if month is None:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def parse_google_timeseries_csv(
    path: Path,
    fx_warnings: Optional[List[str]] = None,
    rates: Optional[Dict[str, float]] = None,
) -> List[Dict[str, Any]]:
    from io_utils import read_csv_rows

    rows = read_csv_rows(path)
    if not rows:
        return []
    header = [str(c or "").strip() for c in rows[0]]
    # Экспорт Google иногда даёт «Kлики» с латинской K — нормализуем для поиска
    def _hl(h: str) -> str:
        s = str(h).lower()
        return s.replace("kлик", "клик")

    # найти индексы
    def col(*names):
        for i, h in enumerate(header):
            hl = _hl(h)
            for n in names:
                if n.lower() in hl:
                    return i
        return -1

    i_date = col("дата", "date")
    i_clicks = col("клик", "clicks")
    i_imp = col("показ", "impression")
    i_spend = col("расход", "cost", "spend")
    if i_date < 0 or i_spend < 0:
        raise ValueError(f"Не найдены колонки Дата/Расходы в {path}")

    ym = None
    mfile = re.search(r"(\d{4})\.(\d{2})\.(\d{2})-(\d{4})\.(\d{2})\.(\d{2})", path.name)
    if mfile:
        ym = (int(mfile.group(1)), int(mfile.group(2)))

    rates_map = rates if rates is not None else load_rates()
    warn = fx_warnings

    out: List[Dict[str, Any]] = []
    for r in rows[1:]:
        if i_date >= len(r):
            continue
        raw_d = r[i_date]
        iso = _parse_russian_date(str(raw_d), ym)
        if not iso:
            continue
        spend_usd = parse_amount(r[i_spend] if i_spend < len(r) else 0)
        clicks = int(float(parse_amount(r[i_clicks]))) if i_clicks >= 0 and i_clicks < len(r) else 0
        if i_imp >= 0 and i_imp < len(r):
            impressions = int(float(parse_amount(r[i_imp])))
        else:
            impressions = clicks * 10
        leads = max(1, clicks // 8) if clicks else 1
        spend_kzt, w = usd_to_kzt(spend_usd, iso, rates=rates_map)
        if w and warn is not None:
            warn.append(f"{path.name} {iso}: {w}")
        if spend_kzt is None:
            spend_kzt = 0.0
        out.append(
            {
                "date": iso,
                "channel": "google",
                "channelLabel": "Google Ads",
                "spend": spend_kzt,
                "spendCurrency": "KZT",
                "spendUsd": spend_usd,
                "spendKzt": spend_kzt,
                "impressions": impressions,
                "clicks": clicks,
                "leads": leads,
                "contactsAfterSale": 0,
                "applicationsOut": 0,
            }
        )
    return out
