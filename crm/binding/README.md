# Trip-binding agent

Binds CRM выезды to their Agbis orders by writing the local Firebird junction `MOBILE_PLAN_ORDERS`.
Agbis' public REST cannot bind a trip to an order (proven — `project_agbis_trip_binding`); the only
channel is a row in the local Firebird, which replicates branch→center (~5 min). This agent is that
channel. **One agent runs on the admin machine** (the one with Firebird) and binds everyone's trips.

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
python binding/agent.py                     # daemon, poll every 150s
#   --margin N    id margin above local high-water (default 5; clears center-side replication gaps)
#   --interval S  daemon poll seconds
```

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
