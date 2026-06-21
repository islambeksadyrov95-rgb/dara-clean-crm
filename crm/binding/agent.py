#!/usr/bin/env python
"""Trip-binding agent — binds CRM выезды to their Agbis orders by writing the local Firebird junction.

WHY THIS EXISTS
  Agbis' public REST cannot bind a выезд (MOBILE_PLAN) to an order (DOCS_ORDER) — proven exhaustively
  (project_agbis_trip_binding). The binding is a row in the LOCAL Firebird junction MOBILE_PLAN_ORDERS,
  which replicates branch→center (~5 min) and then shows in REST + the desktop. So the CRM (on Vercel)
  cannot do it; a local agent on a machine with Firebird access must. Architecture: ONE agent on the
  admin machine binds EVERYONE's trips (decision 2026-06-21).

WHAT IT DOES, each poll cycle
  1. Ask CRM (Supabase, service role) for order_trips that are synced (agbis_trip_id set) but not yet
     bound (bound_at null), with the parent order's agbis_order_id (the DOR_ID).
  2. For each: if a junction already exists in Firebird → just mark it bound in CRM (idempotent). Else,
     once the MOBILE_PLAN and DOCS_ORDER rows have replicated into the local DB, insert the junction
     with a SAFE id and mark it bound.

SAFETY (the only way this corrupts data is a bad junction id — see test_agent.py)
  * DEP fields = 3,3,3 (this office = depot 3). Never let the BI-trigger auto-id: under raw SYSDBA it
    uses GEN_CUR_DEP_ID=107 (an artifact) → a 107-prefixed id that never replicates.
  * id prefix MUST stay "103". Built by STRING concat (103||counter) so 9999→10000 gives 10310000,
    not 1040000 (which is depot 4). Counter = (local max suffix)+1+margin; margin clears center-side
    gaps (an id free locally but taken on center — the lag failure that stranded a junction last time).
  * Never MAX+1 blindly after deletions: we verify the candidate is absent in MOBILE_PLAN_ORDERS AND in
    the replication queue MST_META_CHANGES, bumping until free.
  * Generator GEN_MOBILE_PLAN_ORDERS_ID is desynced on this replica (=3) → NOT used.

USAGE
  python binding/agent.py --dry-run --once     # show what it WOULD bind, write nothing
  python binding/agent.py --once               # one pass, real writes
  python binding/agent.py                       # daemon: poll every 150s
Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from ../.env.local, Firebird password from
C:\\Agbis\\LicensingService.ini. Requires firebird-driver + 64-bit fbclient at C:\\fb64client.
"""

import argparse
import datetime
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from firebird.driver import connect, driver_config

DEP = 3
DEP_PREFIX = "103"  # GEN_CUR_DEP_ID for the Dara depot (DEP_SRC_ID=3)
DEP_NEXT_FLOOR = 10400000  # ids >= this are depot 4+ — our 103-band is strictly below
FB_CLIENT = r"C:\fb64client\fbclient.dll"
FB_DSN = "127.0.0.1/3050:C:/Agbis/DB/ARM_7.FDB"
LICENSING_INI = r"C:\Agbis\LicensingService.ini"
JUNCTION_TABLE = "MOBILE_PLAN_ORDERS"
POLL_SECONDS = 150
DEFAULT_MARGIN = 5
ROOT = pathlib.Path(__file__).resolve().parent.parent


# ── pure junction-id logic (unit-tested: binding/test_agent.py) ──────────────
def parse_counter(junction_id):
    """Strip the depot prefix → the counter. Rejects ids from other depots (wrong prefix)."""
    s = str(junction_id)
    if not s.startswith(DEP_PREFIX):
        raise ValueError(f"id {junction_id} not in depot-{DEP} band (prefix {DEP_PREFIX})")
    return int(s[len(DEP_PREFIX):])


def build_id(counter):
    """Agbis builds ids as the STRING concat depPrefix||counter → 103||10000 = 10310000 (stays 103)."""
    return int(DEP_PREFIX + str(counter))


def next_id(local_max, margin=0):
    """Next id strictly above the local max, prefix-safe across the 9999→8-digit boundary."""
    return build_id(parse_counter(local_max) + 1 + margin)


# ── config ───────────────────────────────────────────────────────────────────
def load_env():
    text = (ROOT / ".env.local").read_text(encoding="utf-8", errors="ignore")
    env = dict(re.findall(r"^([A-Z0-9_]+)=(.*)$", text, re.MULTILINE))
    return env["NEXT_PUBLIC_SUPABASE_URL"].strip(), env["SUPABASE_SERVICE_ROLE_KEY"].strip()


def fb_password():
    text = pathlib.Path(LICENSING_INI).read_text(errors="ignore")
    return re.search(r"Password=(.+)", text).group(1).strip()


# ── CRM (Supabase PostgREST, service role bypasses RLS) ──────────────────────
class Crm:
    def __init__(self, url, key):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def _req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=self.headers, method=method)
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None

    def unbound_trips(self):
        """Synced-but-unbound trips + the parent order's dor_id (agbis_order_id)."""
        q = ("/order_trips?select=id,agbis_trip_id,order_id,orders(agbis_order_id,agbis_status_name)"
             "&agbis_trip_id=not.is.null&bound_at=is.null&order=created_at.asc")
        return self._req("GET", q) or []

    def mark_bound(self, trip_uuid, junction_id):
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        body = {"bound_at": now, "junction_id": str(junction_id)}
        self._req("PATCH", f"/order_trips?id=eq.{trip_uuid}", body)


# ── Firebird ─────────────────────────────────────────────────────────────────
def fb_connect():
    driver_config.fb_client_library.value = FB_CLIENT
    return connect(FB_DSN, user="SYSDBA", password=fb_password())


def _scalar(cur, sql, params=()):
    cur.execute(sql, params)
    row = cur.fetchone()
    return row[0] if row else None


def local_max_junction(cur):
    return _scalar(cur, f"select max(ID) from {JUNCTION_TABLE} where DEP_SRC_ID=? and ID < ?", (DEP, DEP_NEXT_FLOOR))


def id_taken(cur, cand):
    if _scalar(cur, f"select count(*) from {JUNCTION_TABLE} where ID=?", (cand,)):
        return True
    in_queue = _scalar(cur, "select count(*) from MST_META_CHANGES where ID=? and UPPER(TABLE_NAME)=?",
                       (cand, JUNCTION_TABLE))
    return bool(in_queue)


def safe_junction_id(cur, margin):
    """Strictly above the live high-water mark, verified free in the table AND the replication queue."""
    local_max = local_max_junction(cur)
    if local_max is None:
        raise RuntimeError("no depot-3 junctions found — refusing to guess a base id")
    cand = next_id(local_max, margin)
    while id_taken(cur, cand):
        cand = build_id(parse_counter(cand) + 1)
    return cand


def existing_junction(cur, trip_id, dor_id):
    return _scalar(cur, f"select ID from {JUNCTION_TABLE} where MOBILE_PLAN_ID=? and DOR_ID=?", (trip_id, dor_id))


def fk_rows_present(cur, trip_id, dor_id):
    has_plan = _scalar(cur, "select count(*) from MOBILE_PLAN where ID=?", (trip_id,))
    has_order = _scalar(cur, "select count(*) from DOCS_ORDER where ID=?", (dor_id,))
    return bool(has_plan), bool(has_order)


def insert_junction(cur, jid, trip_id, dor_id):
    cur.execute(
        f"insert into {JUNCTION_TABLE} (ID, MOBILE_PLAN_ID, DOR_ID, DEP_ID, LAST_DEP_ID, DEP_SRC_ID) "
        f"values (?, ?, ?, ?, ?, ?)",
        (jid, trip_id, dor_id, DEP, DEP, DEP),
    )


# ── core ─────────────────────────────────────────────────────────────────────
def _log(msg):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def bind_trip(crm, con, cur, t, margin, dry_run):
    """Bind one trip. Returns one of: bound / already / wait / skip / dry."""
    order = t.get("orders") or {}
    dor = order.get("agbis_order_id")
    trip_id = int(t["agbis_trip_id"])
    if not dor:
        _log(f"skip trip {trip_id}: order not synced (no agbis_order_id)")
        return "skip"
    dor_id = int(dor)

    ex = existing_junction(cur, trip_id, dor_id)
    if ex:
        if not dry_run:
            crm.mark_bound(t["id"], ex)
        _log(f"already bound trip {trip_id} -> order {dor_id} (junction {ex})" + (" [dry]" if dry_run else " -> marked"))
        return "already"

    has_plan, has_order = fk_rows_present(cur, trip_id, dor_id)
    if not (has_plan and has_order):
        _log(f"wait trip {trip_id} -> order {dor_id}: not yet in local DB (plan={has_plan} order={has_order})")
        return "wait"

    jid = safe_junction_id(cur, margin)
    if dry_run:
        _log(f"WOULD bind trip {trip_id} -> order {dor_id} as junction {jid} [dry]")
        return "dry"
    insert_junction(cur, jid, trip_id, dor_id)
    con.commit()
    crm.mark_bound(t["id"], jid)
    _log(f"BOUND trip {trip_id} -> order {dor_id} as junction {jid}")
    return "bound"


def run_once(crm, margin, dry_run, trip_filter=None):
    trips = crm.unbound_trips()
    if trip_filter is not None:
        trips = [t for t in trips if str(t.get("agbis_trip_id")) == str(trip_filter)]
    _log(f"{len(trips)} unbound synced trip(s)" + (f" [filter trip={trip_filter}]" if trip_filter else ""))
    if not trips:
        return
    con = fb_connect()
    cur = con.cursor()
    try:
        for t in trips:
            try:
                bind_trip(crm, con, cur, t, margin, dry_run)
            except Exception as e:  # one bad trip must not stop the batch (resilience.md)
                con.rollback()
                _log(f"ERROR trip {t.get('agbis_trip_id')}: {e}")
    finally:
        con.close()


def main():
    ap = argparse.ArgumentParser(description="Agbis trip-binding agent")
    ap.add_argument("--once", action="store_true", help="one pass then exit (default: daemon)")
    ap.add_argument("--dry-run", action="store_true", help="show what would bind, write nothing")
    ap.add_argument("--margin", type=int, default=DEFAULT_MARGIN, help="id margin above local high-water")
    ap.add_argument("--interval", type=int, default=POLL_SECONDS, help="daemon poll seconds")
    ap.add_argument("--trip", help="bind only this agbis_trip_id (targeted single bind)")
    args = ap.parse_args()

    url, key = load_env()
    crm = Crm(url, key)
    mode = "dry-run" if args.dry_run else "live"
    if args.once:
        _log(f"binding agent — one pass ({mode}, margin={args.margin})")
        run_once(crm, args.margin, args.dry_run, args.trip)
        return
    _log(f"binding agent — daemon every {args.interval}s ({mode}, margin={args.margin}). Ctrl+C to stop.")
    while True:
        try:
            run_once(crm, args.margin, args.dry_run, args.trip)
        except Exception as e:
            _log(f"cycle error: {e}")
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
