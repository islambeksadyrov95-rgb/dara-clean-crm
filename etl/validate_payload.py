# -*- coding: utf-8 -*-
"""Проверки канонического JSON: COUNT, SUM paid, min/max date."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple


def validate(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
    errs: List[str] = []
    tx = data.get("transactions") or []
    meta = data.get("meta") or {}
    mkt = data.get("marketingDaily") or []
    plans = (data.get("plans") or {}).get("daily") or []
    if not tx:
        if meta.get("salesSource") == "none" and meta.get("salesNote"):
            errs.append("OK: transactions пуст (режим без таблицы сделок, см. meta.salesNote)")
        elif mkt or plans:
            errs.append("OK: transactions пуст, есть маркетинг или план (сводный режим)")
        else:
            errs.append("transactions пуст и нет маркетинга/плана")
            return False, errs
    else:
        dates = [t.get("date") for t in tx if t.get("date")]
        if not dates:
            errs.append("нет дат")
        else:
            ds = sorted(dates)
            errs.append(f"OK dates: {ds[0]}..{ds[-1]} ({len(ds)} строк)")

        paid = [t for t in tx if t.get("status") == "paid"]
        s = sum(float(t.get("amount") or 0) for t in paid)
        errs.append(f"OK SUM paid: {s:.2f} KZT ({len(paid)} сделок)")

    if meta.get("currency") != "KZT":
        errs.append(f"WARN: meta.currency={meta.get('currency')!r}, ожидается KZT")

    if mkt:
        mdates = sorted({str(m.get("date", ""))[:10] for m in mkt if m.get("date")})
        if mdates:
            errs.append(f"OK marketingDaily: {mdates[0]}..{mdates[-1]} ({len(mkt)} строк)")
        chans: Dict[str, int] = {}
        for m in mkt:
            c = str(m.get("channel") or "?")
            chans[c] = chans.get(c, 0) + 1
        errs.append(f"OK marketingDaily по каналам: {dict(sorted(chans.items()))}")
        w = meta.get("warnings") or []
        if w:
            errs.append(f"INFO meta.warnings ({len(w)}): {w[:5]}{'...' if len(w) > 5 else ''}")

    if plans:
        pdates = sorted({str(p.get("date", ""))[:10] for p in plans if p.get("date")})
        if pdates:
            pt = sum(float(p.get("amount") or 0) for p in plans)
            errs.append(f"OK plans.daily: {pdates[0]}..{pdates[-1]} ({len(plans)} дней, сумма {pt:.2f} KZT)")

    dds = data.get("dds") or []
    if dds:
        yrs = [str(d.get("year") or "") for d in dds]
        errs.append(f"OK dds: {len(dds)} лист(ов), годы {', '.join(yrs)}")

    fp = data.get("financePayrollDaily") or []
    if fp:
        errs.append(f"OK financePayrollDaily: {len(fp)} строк")

    fatal = [e for e in errs if e == "transactions пуст и нет маркетинга/плана" or e.startswith("нет дат")]
    return len(fatal) == 0, errs


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "dashboard-data.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    ok, msgs = validate(data)
    for m in msgs:
        print(m)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
