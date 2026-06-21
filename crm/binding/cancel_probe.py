#!/usr/bin/env python
"""Controlled cancel-test tooling for CANCEL-FEATURE-RND.md (NOT the production feature).

Inspects an order's baseline + return-table shape, or runs the proven raw-cancel recipe
(binding/cancel_recipe.py) and prints the local effect + replication-queue diff.

  python binding/cancel_probe.py --dor 100354                   # inspect (no write)
  python binding/cancel_probe.py --dor 100354 --commit          # run the recipe (reason 8), commit, show effect
  python binding/cancel_probe.py --dor 100354 --commit --reason 7

The recipe runs in ONE transaction (any failed statement → rollback). The Firebird connection
uses WIN1251 for the cyrillic COMMENT. Reuses cancel_recipe so probe and agent share one recipe.
"""

import argparse
import sys

from cancel_recipe import RETURNS_TABLE, apply_cancel, connect_cancel, order_header, service_lines


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
    header = order_header(cur, dor)
    print(f"DOCS_ORDER header (ID,STATUS,KREDIT,DEBET): {header}")
    if not header:
        print("  !! order not found locally — not replicated yet")
        return
    lines = service_lines(cur, dor)
    print(f"service lines ({len(lines)}): ID,STATUS,PRICE,KREDIT,DEBET,COST,RETURNED,DEP_SRC")
    for ln in lines:
        print(f"  {ln}")
    print(f"MST_META_CHANGES max SEQ_ID = {meta_max(cur)}")
    print(f"\n{RETURNS_TABLE} columns (name, NOT_NULL, HAS_DEFAULT):")
    for col in returns_columns(cur):
        flag = " <-- NOT NULL, no default" if (col[1] == 1 and col[2] == 0) else ""
        print(f"  {col[0]:<24} null_flag={col[1]} has_default={col[2]}{flag}")
    ex = existing_returns(cur, [ln[0] for ln in lines])
    print(f"\nexisting returns for these DOS: {ex or 'none'}")


def cancel(con, cur, dor, reason_id, comment):
    boundary = meta_max(cur)
    print(f"meta boundary before write: SEQ_ID={boundary}")
    result = apply_cancel(con, cur, dor, reason_id, comment)
    if result["already"]:
        print("order already status 7 — idempotent no-op (rolled back)")
        return
    print(f"COMMITTED. touched {result['touched']} line(s).\n--- local effect ---")
    print(f"header now: {order_header(cur, dor)}")
    print(f"returns now: {existing_returns(cur, result['dos_ids'])}")
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
    ap.add_argument("--reason", type=int, default=8, choices=(7, 8), help="RETURN_KIND_ID: 7 client refusal, 8 reg. error")
    ap.add_argument("--comment", default="ТЕСТ отмена (контролируемый тест R&D, удалить)", help="return COMMENT")
    args = ap.parse_args()

    con = connect_cancel()
    cur = con.cursor()
    try:
        if not args.commit:
            inspect(cur, args.dor)
            print("\n[inspect only — no write. add --commit to execute the recipe]")
        else:
            cancel(con, cur, args.dor, args.reason, args.comment)
    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())
