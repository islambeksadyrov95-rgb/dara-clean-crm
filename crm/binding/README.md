# Trip-binding + order-cancel agent

Two jobs, both needing a LOCAL Firebird write that Agbis' public REST cannot do (proven):
1. **Bind выезды** to their orders (junction `MOBILE_PLAN_ORDERS`) — `project_agbis_trip_binding`.
2. **Execute order cancellations** (zero services + return row + status 7; the `ZERO_TOVARS` trigger
   also cancels the order's trips) — `project_cancel_feature`, recipe in `cancel_recipe.py`.

The CRM (Vercel) only writes intent to Supabase (`order_trips`, `orders.cancel_requested`); this agent
is the only thing that can touch the local Firebird. **It MUST run on the admin machine** (the one with
Agbis + Firebird at `127.0.0.1:3050`) — never on Vercel. One agent runs for everyone.

## What it does (each poll)
1. Asks CRM (Supabase, service role) for `order_trips` that are synced (`agbis_trip_id` set) but not
   bound (`bound_at` null), with the parent order's `agbis_order_id` (the `DOR_ID`).
2. For each:
   - junction already exists in Firebird → mark `bound_at` in CRM (idempotent, no write);
   - else, once the `MOBILE_PLAN` and `DOCS_ORDER` rows have replicated locally → insert the junction
     with a safe id (DEP `3,3,3`, prefix `103`, above the local high-water mark), then mark `bound_at`.

## Run
```
python binding/agent.py --dry-run --once   # show what it WOULD bind, write nothing
python binding/agent.py --once             # one real pass
python binding/agent.py                     # daemon, poll every 5s (near-instant)
#   --margin N    id margin above local high-water (default 5; clears center-side replication gaps)
#   --interval S  daemon poll seconds
```

## Autostart (permanent — MUST be running for binding/cancel to work)
Without the daemon running, выезды never bind and «Отменить заказ» only sets a flag that never executes.
Set up on the admin machine (no admin rights needed — Startup folder, not a Scheduled Task):
- `agent-run.cmd` — wrapper: runs the daemon, **auto-restarts** if it ever exits, logs to `agent.log`.
- `agent-autostart.vbs` — launches the wrapper **hidden** at logon. Installed by copying it into
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DaraClean-AgbisAgent.vbs`.
- Start now without re-logon: `wscript "binding\agent-autostart.vbs"`.
- Check it's alive: `Get-CimInstance Win32_Process -Filter "Name='python.exe'"` (cmdline has `agent.py`),
  or `tail binding/agent.log`. Stop: kill that python PID (the wrapper restarts it in 15s — to stop for
  good, end the hidden `cmd`/`wscript` too, or delete the Startup file).
- After a code update (`git pull`): kill the python PID; the wrapper relaunches the new code in 15s.
- If the machine is hardcoded elsewhere: edit the path in both `agent-run.cmd` and the Startup `.vbs`.

## Requires (admin machine only)
- `firebird-driver` (`pip install firebird-driver`) + 64-bit `fbclient.dll` at `C:\fb64client`
  (the bundled Agbis client is 32-bit and will not load in 64-bit Python).
- `../.env.local` with `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- Firebird password is read from `C:\Agbis\LicensingService.ini` `[Firebird] Password=`.

## Safety — junction id (see `test_agent.py`)
The only way this corrupts data is a bad junction id:
- DEP must be `3,3,3` (this office = depot 3). The BI-trigger's auto-id uses `GEN_CUR_DEP_ID=107`
  under raw SYSDBA → never replicates; so we set the id explicitly.
- id prefix must stay `103`, built by **string concat** (`103`||counter) so `9999→10000` gives
  `10310000`, never `1040000` (depot 4). Unit-tested.
- never blind `MAX+1` after deletions: the candidate is verified absent in `MOBILE_PLAN_ORDERS` and in
  the replication queue `MST_META_CHANGES`, bumping until free.
- the node generator `GEN_MOBILE_PLAN_ORDERS_ID` is desynced (=3 on this replica) → NOT used.

Verify a binding landed on center: REST `Trip{id}.orders[]`, or the desktop (immediate — reads local DB).
