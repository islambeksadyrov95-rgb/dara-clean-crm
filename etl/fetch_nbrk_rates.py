# -*- coding: utf-8 -*-
"""Загрузка курсов USD/KZT с nationalbank.kz (get_rates.cfm) в nbrk_usd_kzt.json."""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

_ETL = Path(__file__).resolve().parent
OUT = _ETL / "data" / "nbrk_usd_kzt.json"

# Таблица НБ: USD обычно с quantity 1, ищем число после USD
_RE_USD = re.compile(
    r"USD\s*</td>\s*<td[^>]*>([\d\s]+,\d+)</td>\s*<td[^>]*>([\d\s]+,\d+)</td>",
    re.I | re.S,
)
_RE_SIMPLE = re.compile(r"USD[^0-9]*(\d+)[\s\u00a0]*(\d+,\d+)", re.I)


def _parse_amount(s: str) -> float:
    return float(s.replace("\u00a0", "").replace(" ", "").replace(",", "."))


def fetch_rate(iso_date: str) -> float | None:
    dt = datetime.strptime(iso_date, "%Y-%m-%d")
    url = f"https://nationalbank.kz/rss/get_rates.cfm?fdate={dt.strftime('%d.%m.%Y')}"
    req = urllib.request.Request(url, headers={"User-Agent": "DaraClean-ETL/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None
    m = _RE_USD.search(html)
    if m:
        return _parse_amount(m.group(2))
    m2 = _RE_SIMPLE.search(html)
    if m2:
        return _parse_amount(m2.group(2))
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="date_from", default="2025-09-01")
    ap.add_argument("--to", dest="date_to", default="2026-03-31")
    ap.add_argument("-o", type=Path, default=OUT)
    args = ap.parse_args()

    start = datetime.strptime(args.date_from, "%Y-%m-%d")
    end = datetime.strptime(args.date_to, "%Y-%m-%d")
    rates: dict[str, float] = {}
    d = start
    last: float | None = None
    while d <= end:
        iso = d.strftime("%Y-%m-%d")
        r = fetch_rate(iso)
        if r is not None:
            last = r
            rates[iso] = r
        elif last is not None:
            rates[iso] = last
        d += timedelta(days=1)

    if not rates:
        print("Не удалось получить курсы (сеть или разметка НБ).", file=sys.stderr)
        return 1

    out = {
        "meta": {
            "source": "nationalbank.kz/rss/get_rates.cfm",
            "generated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "range": [args.date_from, args.date_to],
        },
        "rates": rates,
    }
    args.o.parent.mkdir(parents=True, exist=True)
    args.o.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(rates)} дней -> {args.o}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
