#!/usr/bin/env python
"""Reusable raw-Firebird order-cancel recipe (proven GO — docs/integrations/agbis-api/CANCEL-FEATURE-RND.md).

Shared by binding/cancel_probe.py (test tooling) and binding/agent.py (cancel poll, T8).
apply_cancel() cancels an UNPAID Agbis order in ONE transaction: zero service lines + insert a
return row (BI-trigger ids it 107||seq) + zero addon money + DOCS_ORDER status 7 / money 0. The
DOCS_ORDER_AIU_ZERO_TOVARS trigger then zeros goods lines AND cancels the order's trips
(mobile_plan.mp_status_id=2) — but only when ALL orders on the trip are status 7 (shared-trip
guard built into the trigger). So the caller needs NO trip-cancellation code.

Cyrillic COMMENT needs a WIN1251 connection (connect_cancel). Any failed statement raises — the
caller must rollback; apply_cancel itself commits only on full success.
"""

from firebird.driver import connect, driver_config

import agent_config  # central path/credential resolver

CANCELLED_STATUS_ID = 7
USER_ISLAMBEK = 1057  # DOC_ORDER_SERV_RETURNS.USER_ID (Islambek)
RETURNS_TABLE = "DOC_ORDER_SERV_RETURNS"
CANCEL_REASON_IDS = (7, 8)  # RETURN_KIND_ID: 7 client refusal, 8 registration error


def connect_cancel():
    """SYSDBA connection with WIN1251 charset (required to write a cyrillic COMMENT)."""
    driver_config.fb_client_library.value = agent_config.fb_client()
    return connect(agent_config.fb_dsn(), user="SYSDBA", password=agent_config.fb_password(), charset="WIN1251")


def order_header(cur, dor):
    """(ID, STATUS_ID, KREDIT, DEBET) or None. DEBET > 0 means the client has paid."""
    cur.execute("select ID, STATUS_ID, KREDIT, DEBET from DOCS_ORDER where ID=?", (dor,))
    return cur.fetchone()


def service_lines(cur, dor):
    cur.execute(
        "select ID, STATUS_ID, PRICE, KREDIT, DEBET, COST, RETURNED, DEP_SRC_ID "
        "from DOC_ORDER_SERVICES where DOC_ORDER_ID=?",
        (dor,),
    )
    return cur.fetchall()


def is_unpaid(debet):
    """Authoritative payment guard for the agent: nothing paid → safe to raw-cancel."""
    return debet is None or debet == 0


def apply_cancel(con, cur, dor, reason_id, comment):
    """Run the recipe and commit. Returns a result dict; raises on error (caller rolls back).

    - order missing locally   → raises ValueError
    - order already status 7   → {"already": True, "committed": False, ...} (idempotent no-op)
    - otherwise                → zeroes lines/returns/addons + DOCS_ORDER status 7, commits.
    """
    if reason_id not in CANCEL_REASON_IDS:
        raise ValueError(f"reason_id {reason_id} not in {CANCEL_REASON_IDS}")
    header = order_header(cur, dor)
    if header is None:
        raise ValueError(f"order {dor} not found locally (not replicated?)")
    if header[1] == CANCELLED_STATUS_ID:
        con.rollback()
        return {"already": True, "committed": False, "touched": 0, "dos_ids": []}
    lines = service_lines(cur, dor)
    dos_ids = [ln[0] for ln in lines]
    touched = 0
    for ln in lines:
        dos, status = ln[0], ln[1]
        if status == CANCELLED_STATUS_ID:
            continue
        cur.execute(
            "update DOC_ORDER_SERVICES set PRICE=0, DEBET=0, KREDIT=0, COST=0, "
            "STATUS_ID=?, RETURNED=1, LAST_TIME_CH_STATUS=current_timestamp where ID=?",
            (CANCELLED_STATUS_ID, dos),
        )
        cur.execute(
            f"insert into {RETURNS_TABLE} (DOS_ID, RETURN_KIND_ID, DT, USER_ID, COMMENT) "
            "values (?, ?, current_timestamp, ?, ?)",
            (dos, reason_id, USER_ISLAMBEK, comment),
        )
        cur.execute("select ID, CHANGE_PRICE from ADDON_ORDER_SERVICES where LINE_ID=?", (dos,))
        for addon in cur.fetchall():
            if addon[1]:
                cur.execute("update ADDON_ORDER_SERVICES set CHANGE_PRICE=0 where ID=?", (addon[0],))
        touched += 1
    cur.execute("update DOCS_ORDER set STATUS_ID=?, KREDIT=0, DEBET=0 where ID=?", (CANCELLED_STATUS_ID, dor))
    con.commit()
    return {"already": False, "committed": True, "touched": touched, "dos_ids": dos_ids}
