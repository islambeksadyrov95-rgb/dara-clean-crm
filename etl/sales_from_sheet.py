# -*- coding: utf-8 -*-
"""
Продажи: одна строка = одна сделка. Колонки (кириллица или латиница):
дата, клиент, менеджер, продукт, сумма, план, статус, этап, источник, сегмент (B2B/B2C) — опционально.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from date_parse import parse_to_iso
from io_utils import read_csv_rows, read_excel_sheet, rows_to_records
from parse_kzt import parse_amount

STATUS_MAP = {"оплачено": "paid", "paid": "paid", "не оплачено": "unpaid", "unpaid": "unpaid", "потеряно": "lost", "lost": "lost"}

FUNNEL_MAP = {
    "лид": "lead",
    "lead": "lead",
    "контакт": "contact",
    "contact": "contact",
    "диалог": "dialog",
    "dialog": "dialog",
    "сделка": "deal",
    "deal": "deal",
    "оплата": "payment",
    "payment": "payment",
}


def _slug(s: str) -> str:
    h = hashlib.md5(s.strip().encode("utf-8")).hexdigest()[:12]
    return f"id-{h}"


def normalize_header(h: str) -> str:
    return str(h or "").strip().lower().replace("ё", "е")


_ITOGO_DATE = re.compile(r"Итого\s+за\s+(\d{1,2}\.\d{1,2}\.\d{4})", re.IGNORECASE)


def parse_pivot_payment_groups(rows: List[List[Any]]) -> List[dict]:
    """
    Сводный отчёт «Отчет по оплатам групп услуг»: блоки по дням (--- Таблица N ---),
    строки групп до строки «Итого за DD.MM.YYYY». Синтетические строки «одна строка = группа за день».
    """
    buffer: List[List[Any]] = []
    out: List[dict] = []

    for row in rows:
        if not row:
            continue
        c0 = str(row[0] or "").strip()
        if "---" in c0 and "Таблица" in c0:
            buffer = []
            continue
        if c0.lower().startswith("группа изделий"):
            buffer = []
            continue
        if not c0:
            continue
        if c0.lower() in ("нал.", "безнал.") or (len(row) > 2 and str(row[2] or "").strip().lower() == "нал."):
            continue
        m = _ITOGO_DATE.search(c0)
        if m:
            ds = parse_to_iso(m.group(1))
            if len(ds) < 10:
                buffer = []
                continue
            date_iso = ds[:10]
            for buf in buffer:
                prod = str(buf[0] or "").strip()
                if not prod or prod.lower().startswith("итого"):
                    continue
                cash = parse_amount(buf[2] if len(buf) > 2 else 0)
                card = parse_amount(buf[3] if len(buf) > 3 else 0)
                amt = cash + card
                if amt <= 0:
                    continue
                out.append(
                    {
                        "дата": date_iso,
                        "клиент": "Агрегат отчёта",
                        "менеджер": "—",
                        "продукт": prod,
                        "сумма": amt,
                        "статус": "paid",
                        "этап": "payment",
                        "источник": "pivot_groups",
                        "сегмент": "B2C",
                    }
                )
            buffer = []
            continue
        if "итого" in c0.lower():
            continue
        if len(row) >= 4:
            cash = parse_amount(row[2] if len(row) > 2 else 0)
            card = parse_amount(row[3] if len(row) > 3 else 0)
            if cash + card > 0:
                buffer.append(row)
    return out


def records_to_payload(records: List[dict]) -> Dict[str, Any]:
    clients: Dict[str, dict] = {}
    managers: Dict[str, dict] = {}
    products: Dict[str, dict] = {}
    transactions: List[dict] = []

    for i, row in enumerate(records):
        keys = {normalize_header(k): v for k, v in row.items()}

        def get(*names):
            for n in names:
                nn = normalize_header(n)
                if nn in keys and keys[nn] is not None and str(keys[nn]).strip():
                    return keys[nn]
            return None

        d_raw = get("дата", "date")
        if d_raw is None:
            continue
        date_s = parse_to_iso(d_raw)
        if len(date_s) < 10:
            continue

        client_name = str(get("клиент", "client", "clientid") or "Неизвестно").strip()
        mgr_name = str(get("менеджер", "manager", "managerid") or "Менеджер").strip()
        prod_name = str(get("продукт", "product", "услуга", "productid") or "Услуга").strip()
        amount = parse_amount(get("сумма", "amount"))
        plan_amt = (
            parse_amount(get("план", "planamount"))
            if get("план", "planamount") is not None
            else 0.0
        )

        st = str(get("статус", "status") or "paid").strip().lower()
        status = STATUS_MAP.get(st, "paid" if st not in ("unpaid", "lost") else st)

        fs = str(get("этап", "funnelstage", "воронка") or "payment").strip().lower()
        funnel = FUNNEL_MAP.get(fs, fs if fs in ("lead", "contact", "dialog", "deal", "payment") else "payment")

        src = str(get("источник", "source") or "import").strip()
        seg = str(get("сегмент", "segment") or "B2C").strip().upper()
        if seg not in ("B2B", "B2C"):
            seg = "B2C"

        cid = _slug("c|" + client_name)
        mid = _slug("m|" + mgr_name)
        pid = _slug("p|" + prod_name)

        if cid not in clients:
            clients[cid] = {"id": cid, "name": client_name, "segment": seg, "registeredAt": date_s}
        if mid not in managers:
            managers[mid] = {"id": mid, "name": mgr_name}
        if pid not in products:
            products[pid] = {"id": pid, "name": prod_name}

        transactions.append(
            {
                "id": f"trx-{i+1}",
                "date": date_s,
                "clientId": cid,
                "managerId": mid,
                "productId": pid,
                "amount": amount,
                "planAmount": plan_amt,
                "status": status,
                "funnelStage": funnel,
                "source": src,
            }
        )

    return {
        "meta": {"currency": "KZT", "source": "sales_etl"},
        "clients": list(clients.values()),
        "managers": list(managers.values()),
        "products": list(products.values()),
        "transactions": transactions,
    }


def load_sales(
    path: Union[str, Path],
    sheet: Union[int, str] = 0,
    header_row: int = 0,
) -> Dict[str, Any]:
    p = Path(path)
    if p.suffix.lower() == ".csv":
        rows = read_csv_rows(p)
        recs = rows_to_records(rows, header_row)
    else:
        rows = read_excel_sheet(p, sheet)
        recs = rows_to_records(rows, header_row)
    payload = records_to_payload(recs)
    if not payload.get("transactions"):
        alt = parse_pivot_payment_groups(rows)
        if alt:
            payload = records_to_payload(alt)
            payload.setdefault("meta", {"currency": "KZT", "source": "sales_etl"})
            payload["meta"]["pivotSource"] = True
    return payload


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("path", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("sales.json"))
    args = ap.parse_args()
    payload = load_sales(args.path)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(payload['transactions'])} сделок → {args.out}")


if __name__ == "__main__":
    main()
