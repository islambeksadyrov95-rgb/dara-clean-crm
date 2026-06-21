#!/usr/bin/env python
"""Controlled cancel-test tooling for CANCEL-FEATURE-RND.md (NOT the production feature).

Cancels an UNPAID Agbis order by the raw Firebird recipe: zero service lines + insert a
return row (BI-trigger ids it 107||seq) + zero header + status 7. The center then mirrors it
(~10 min) — the go/no-go signal.

  python binding/cancel_probe.py --dor 100354            # inspect baseline + return-table shape (no write)
  python binding/cancel_probe.py --dor 100354 --commit   # run the recipe in one tx, commit, show local effect

Whole recipe runs in ONE transaction: any failed statement -> rollback -> nothing hits production.
Firebird write needs cyrillic COMMENT -> charset WIN1251. Reads here are numeric/ASCII so WIN1251 is fine.
"""

import argparse
import pathlib
import re
import sys

from firebird.driver import connect, driver_config

FB_CLIENT = r"C:\fb64client\fbclient.dll"
FB_DSN = "127.0.0.1/3050:C:/Agbis/DB/ARM_7.FDB"
LICENSING_INI = r"C:\Agbis\LicensingService.ini"

CANCELLED_STATUS_ID = 7
RETURN_KIND_REGISTRATION_ERROR = 8  # «Ошибка при оформлении» (7 = «Отказ клиента от обработки»)
USER_ISLAMBEK = 1057
RETURNS_TABLE = "DOC_ORDER_SERV_RETURNS"


def fb_password():
    text = pathlib.Path(LICENSING_INI).read_text(errors="ignore")
    return re.search(r"Password=(.+)", text).group(1).strip()


def fb_connect():
    driver_config.fb_client_library.value = FB_CLIENT
    return connect(FB_DSN, user="SYSDBA", password=fb_password(), charset="WIN1251")


def fetch_header(cur, dor):
    cur.execute("select ID, STATUS_ID, KREDIT, DEBET from DOCS_ORDER where ID=?", (dor,))
    return cur.fetchone()


def fetch_lines(cur, dor):
    cur.execute(
        "select ID, STATUS_ID, PRICE, KREDIT, DEBET, COST, RETURNED, DEP_SRC_ID "
        "from DOC_ORDER_SERVICES where DOC_ORDER_ID=?",
        (dor,),
    )
    return cur.fetchall()


def meta_max(cur):
    cur.execute("select max(SEQ_ID) from MST_META_CHANGES")
    return cur.fetchone()[0]


def returns_columns(cur):
    cur.execute(
        "select trim(RDB$FIELD_NAME), coalesce(RDB$NULL_FLAG,0), "
        "case when RDB$DEFAULT_SOURCE is null then 0 else 1 end "
        "from RDB$RELATION_FIELDS where RDB$RELATION_NAME=? order by RDB$FIELD_POSITION",
        (RETURNS_TABLE,),
    )
    return cur.fetchall()


def existing_returns(cur, dos_ids):
    if not dos_ids:
        return []
    placeholders = ",".join("?" * len(dos_ids))
    cur.execute(
        f"select ID, DOS_ID, RETURN_KIND_ID, USER_ID from {RETURNS_TABLE} where DOS_ID in ({placeholders})",
        tuple(dos_ids),
    )
    return cur.fetchall()


def inspect(cur, dor):
    header = fetch_header(cur, dor)
    print(f"DOCS_ORDER header: {header}")
    if not header:
        print("  !! order not found locally — not replicated yet")
        return None
    lines = fetch_lines(cur, dor)
    print(f"service lines ({len(lines)}): ID,STATUS,PRICE,KREDIT,DEBET,COST,RETURNED,DEP_SRC")
    for ln in lines:
        print(f"  {ln}")
    print(f"MST_META_CHANGES max SEQ_ID = {meta_max(cur)}")
    print(f"\n{RETURNS_TABLE} columns (name, NOT_NULL, HAS_DEFAULT):")
    for col in returns_columns(cur):
        flag = " <-- NOT NULL, no default" if (col[1] == 1 and col[2] == 0) else ""
        print(f"  {col[0]:<24} null_flag={col[1]} has_default={col[2]}{flag}")
    dos_ids = [ln[0] for ln in lines]
    ex = existing_returns(cur, dos_ids)
    print(f"\nexisting returns for these DOS: {ex or 'none'}")
    return lines


def cancel(con, cur, dor, comment):
    boundary = meta_max(cur)
    print(f"meta boundary before write: SEQ_ID={boundary}")
    lines = fetch_lines(cur, dor)
    touched = 0
    for ln in lines:
        dos, status = ln[0], ln[1]
        if status == CANCELLED_STATUS_ID:
            print(f"  line {dos}: already status 7 — skip")
            continue
        cur.execute(
            "update DOC_ORDER_SERVICES set PRICE=0, DEBET=0, KREDIT=0, COST=0, "
            "STATUS_ID=?, RETURNED=1, LAST_TIME_CH_STATUS=current_timestamp where ID=?",
            (CANCELLED_STATUS_ID, dos),
        )
        cur.execute(
            f"insert into {RETURNS_TABLE} (DOS_ID, RETURN_KIND_ID, DT, USER_ID, COMMENT) "
            "values (?, ?, current_timestamp, ?, ?)",
            (dos, RETURN_KIND_REGISTRATION_ERROR, USER_ISLAMBEK, comment),
        )
        cur.execute("select ID, CHANGE_PRICE from ADDON_ORDER_SERVICES where LINE_ID=?", (dos,))
        for addon in cur.fetchall():
            if addon[1]:
                cur.execute("update ADDON_ORDER_SERVICES set CHANGE_PRICE=0 where ID=?", (addon[0],))
                print(f"  addon {addon[0]}: CHANGE_PRICE zeroed")
        touched += 1
        print(f"  line {dos}: zeroed + status 7 + return inserted")
    cur.execute("update DOCS_ORDER set STATUS_ID=?, KREDIT=0, DEBET=0 where ID=?", (CANCELLED_STATUS_ID, dor))
    if touched == 0:
        print("nothing to cancel (all lines already 7) — rolling back")
        con.rollback()
        return
    con.commit()
    print("COMMITTED.\n--- local effect ---")
    print(f"header now: {fetch_header(cur, dor)}")
    dos_ids = [ln[0] for ln in lines]
    print(f"returns now: {existing_returns(cur, dos_ids)}")
    cur.execute(
        "select SEQ_ID, trim(TABLE_NAME), ID, UNLOADED from MST_META_CHANGES "
        "where SEQ_ID > ? order by SEQ_ID",
        (boundary,),
    )
    rows = cur.fetchall()
    print(f"new MST_META_CHANGES rows ({len(rows)}): SEQ_ID, TABLE, ID, UNLOADED")
    for r in rows:
        print(f"  {r}")


def main():
    ap = argparse.ArgumentParser(description="Controlled Agbis order cancel probe (raw Firebird)")
    ap.add_argument("--dor", type=int, required=True, help="DOCS_ORDER id to cancel")
    ap.add_argument("--commit", action="store_true", help="execute the recipe and commit (default: inspect only)")
    ap.add_argument("--comment", default="ТЕСТ отмена (контролируемый тест R&D, удалить)", help="return COMMENT")
    args = ap.parse_args()

    con = fb_connect()
    cur = con.cursor()
    try:
        if not args.commit:
            inspect(cur, args.dor)
            print("\n[inspect only — no write. add --commit to execute the recipe]")
        else:
            cancel(con, cur, args.dor, args.comment)
    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())
