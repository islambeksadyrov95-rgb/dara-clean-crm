# -*- coding: utf-8 -*-
"""Курс USD/KZT из локального JSON (НБ РК); при отсутствии даты — предыдущий известный."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional

__all__ = ["load_rates", "get_rate", "usd_to_kzt"]

_ETL = Path(__file__).resolve().parent


def load_rates(path: Optional[Path] = None) -> Dict[str, float]:
    p = path or _ETL / "data" / "nbrk_usd_kzt.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    out: Dict[str, float] = {}
    if isinstance(data.get("rates"), dict):
        raw = data["rates"]
    else:
        raw = data
    for k, v in raw.items():
        try:
            out[str(k)[:10]] = float(v)
        except (TypeError, ValueError):
            continue
    return out


def get_rate(iso_date: str, rates: Optional[Dict[str, float]] = None) -> Optional[float]:
    """
    Курс USD за 1 USD в тенге на дату iso_date.
    Если даты нет — ближайший предыдущий торговый день (скан назад до 400 дней).
    """
    r = rates if rates is not None else load_rates()
    if not r:
        return None
    d0 = iso_date[:10]
    if d0 in r:
        return r[d0]
    try:
        dt = datetime.strptime(d0, "%Y-%m-%d")
    except ValueError:
        return None
    for i in range(1, 401):
        prev = (dt - timedelta(days=i)).strftime("%Y-%m-%d")
        if prev in r:
            return r[prev]
    return None


def usd_to_kzt(
    usd: float,
    iso_date: str,
    rates: Optional[Dict[str, float]] = None,
) -> tuple[Optional[float], Optional[str]]:
    """
    Возвращает (сумма KZT, warning или None).
    """
    rate = get_rate(iso_date, rates=rates)
    if rate is None:
        return None, f"Нет курса USD/KZT для {iso_date}"
    return round(usd * rate, 2), None


if __name__ == "__main__":
    rts = load_rates()
    kzt, w = usd_to_kzt(100.0, "2025-09-15", rates=rts)
    print("smoke usd_to_kzt(100, 2025-09-15):", kzt, w or "")
