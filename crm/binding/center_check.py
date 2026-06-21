#!/usr/bin/env python
"""Watch the Agbis CENTER for the cancel of an order to mirror up (CANCEL-FEATURE-RND.md make-or-break).

Two signals each cycle:
  1. local Firebird MST_META_CHANGES.UNLOADED for the cancel rows (0=queued, 1=uploaded).
  2. REST OrderByDateTimeForAll on the order's intake day → center status_id + kredit + service kredit.
GREEN when center shows status 7 AND order kredit 0 AND every service kredit 0.

  python binding/center_check.py --dor 100354 --seqs 1782,1783,1784,1785 --dates 20.06.2026,21.06.2026,22.06.2026 --once
  python binding/center_check.py --dor 100354 --seqs 1782,1783,1784,1785 --dates 21.06.2026,22.06.2026   # watch loop
"""

import argparse
import datetime
import hashlib
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

from firebird.driver import connect, driver_config

FB_CLIENT = r"C:\fb64client\fbclient.dll"
FB_DSN = "127.0.0.1/3050:C:/Agbis/DB/ARM_7.FDB"
LICENSING_INI = r"C:\Agbis\LicensingService.ini"
ROOT = pathlib.Path(__file__).resolve().parent.parent
CANCELLED_STATUS_ID = 7


def env(name):
    text = (ROOT / ".env.local").read_text(encoding="utf-8", errors="ignore")
    m = re.search(rf"^{name}=(.*)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def pwd_sha1(pwd):
    return pwd.lower() if re.fullmatch(r"[0-9a-f]{40}", pwd, re.I) else hashlib.sha1(pwd.encode()).hexdigest()


# ── Agbis REST (mirrors lib/agbis: enc=encodeURIComponent once, decodeAll recursive) ──
def enc(params):
    return urllib.parse.quote(json.dumps(params, ensure_ascii=False), safe="")


def decode_all(value):
    if isinstance(value, str):
        try:
            return urllib.parse.unquote(value.replace("+", " "))
        except Exception:
            return value
    if isinstance(value, list):
        return [decode_all(v) for v in value]
    if isinstance(value, dict):
        return {k: decode_all(v) for k, v in value.items()}
    return value


def _http(url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-type": "application/json; charset=UTF-8"} if body is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=60) as r:
        return decode_all(json.loads(r.read().decode()))


def login(base, user, pwd_hash):
    res = _http(f"{base}/?Login=" + enc({"User": user, "Pwd": pwd_hash, "AsUser": "1"}))
    if str(res.get("error", 0)) != "0" or not res.get("Session_id"):
        raise RuntimeError(f"login failed: {res}")
    return res["Session_id"]


def orders_for_day(base, session, day):
    url = f"{base}/?OrderByDateTimeForAll"
    body = {"OrderByDateTimeForAll": {"StartDate": f"{day} 00:00", "StopDate": f"{day} 23:59"}, "SessionID": session}
    res = _http(url, body)
    return res.get("orders") if isinstance(res.get("orders"), list) else []


def money(raw):
    if isinstance(raw, (int, float)):
        return round(raw)
    if not isinstance(raw, str):
        return None
    cleaned = raw.replace(" ", "").replace("\xa0", "").replace(",", ".")
    if cleaned == "":
        return None
    try:
        return round(float(cleaned))
    except ValueError:
        return None


def find_center(base, session, dor, dates):
    for day in dates:
        for o in orders_for_day(base, session, day):
            if str(o.get("dor_id")) == str(dor):
                svc = o.get("Srvices") if isinstance(o.get("Srvices"), list) else []
                return {
                    "day": day,
                    "status_id": money(o.get("status_id") if o.get("status_id") not in (None, "") else o.get("status")),
                    "status_name": o.get("status_name"),
                    "kredit": money(o.get("kredit")),
                    "services": [{"kredit": money(s.get("kredit")), "status_id": money(s.get("status_id"))} for s in svc],
                }
    return None


# ── local Firebird replication-queue check ──
def fb_unloaded(seqs):
    pw = re.search(r"Password=(.+)", pathlib.Path(LICENSING_INI).read_text(errors="ignore")).group(1).strip()
    driver_config.fb_client_library.value = FB_CLIENT
    con = connect(FB_DSN, user="SYSDBA", password=pw, charset="NONE")
    cur = con.cursor()
    placeholders = ",".join("?" * len(seqs))
    cur.execute(f"select SEQ_ID, UNLOADED from MST_META_CHANGES where SEQ_ID in ({placeholders}) order by SEQ_ID", tuple(seqs))
    rows = cur.fetchall()
    con.close()
    return rows


def is_green(center):
    if not center or center["status_id"] != CANCELLED_STATUS_ID or center["kredit"] not in (0, None):
        return False
    if center["kredit"] != 0:
        return False
    return all(s["kredit"] == 0 for s in center["services"])


def cycle(base, user, pwd_hash, session, dor, seqs, dates):
    rows = fb_unloaded(seqs)
    uploaded = sum(1 for _, u in rows if u == 1)
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] local uploaded {uploaded}/{len(rows)}  {rows}")
    try:
        center = find_center(base, session, dor, dates)
    except Exception as e:
        print(f"  REST err: {e}")
        return None, session
    if center is None:
        print(f"  center: order {dor} not found in {dates}")
        return None, session
    print(f"  center day={center['day']} status={center['status_id']} ({center['status_name']}) "
          f"kredit={center['kredit']} services={center['services']}")
    return center, session


def main():
    ap = argparse.ArgumentParser(description="Watch Agbis center for an order cancel to mirror up")
    ap.add_argument("--dor", required=True)
    ap.add_argument("--seqs", required=True, help="comma list of MST_META_CHANGES SEQ_IDs from the cancel")
    ap.add_argument("--dates", required=True, help="comma list of dd.mm.yyyy intake-day candidates")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=60)
    ap.add_argument("--max-min", type=int, default=18)
    args = ap.parse_args()

    base = env("AGBIS_API_BASE").rstrip("/")
    user = env("AGBIS_API_USER")
    pwd_hash = pwd_sha1(env("AGBIS_API_PWD"))
    if not (base and user and pwd_hash):
        raise SystemExit("missing AGBIS_API_BASE/USER/PWD in .env.local")
    seqs = [int(s) for s in args.seqs.split(",")]
    dates = [d.strip() for d in args.dates.split(",")]

    session = login(base, user, pwd_hash)
    print(f"logged in. watching dor={args.dor} seqs={seqs} dates={dates}")

    deadline = time.monotonic() + args.max_min * 60
    while True:
        try:
            center, session = cycle(base, user, pwd_hash, session, args.dor, seqs, dates)
        except Exception as e:
            print(f"  cycle err: {e} — re-login")
            try:
                session = login(base, user, pwd_hash)
            except Exception as e2:
                print(f"  re-login failed: {e2}")
        else:
            if is_green(center):
                print("\n*** GREEN: center shows status 7 + kredit 0 (order & services). Firebird cancel mirrors up. ***")
                return
        if args.once or time.monotonic() >= deadline:
            print("\n[stop] " + ("once" if args.once else f"timeout {args.max_min}min — NOT green yet"))
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
