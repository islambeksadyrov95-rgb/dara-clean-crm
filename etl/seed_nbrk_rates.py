# -*- coding: utf-8 -*-
"""Заполнение nbrk_usd_kzt.json без сети (фиксированный курс-заглушка). Замените fetch_nbrk_rates.py при доступе к НБ."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

_ETL = Path(__file__).resolve().parent
OUT = _ETL / "data" / "nbrk_usd_kzt.json"


def main() -> None:
    ap_from = "2025-09-01"
    ap_to = "2026-03-31"
    start = datetime.strptime(ap_from, "%Y-%m-%d")
    end = datetime.strptime(ap_to, "%Y-%m-%d")
    rates: dict[str, float] = {}
    d = start
    base = 530.0
    while d <= end:
        rates[d.strftime("%Y-%m-%d")] = round(base + (d.toordinal() % 30) * 0.01, 2)
        d += timedelta(days=1)
    out = {
        "meta": {
            "source": "seed_fallback",
            "note": "Замените на вывод fetch_nbrk_rates.py при рабочем парсере НБ",
            "generated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "rates": rates,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK seed {len(rates)} -> {OUT}")


if __name__ == "__main__":
    main()
