# Wave 3 contract — Agbis trips → CRM `order_trips` sync (read side)

> **Owner:** the import / read-sync stream (`/api/cron/agbis`, `lib/agbis/sync-orders.ts`), **NOT**
> the order-write stream. Written by the write stream as a handoff so В3 can be picked up without
> re-deriving the model. The write side of the order-parity epic (В1 create, В2 edit) is **done**.
> One Window Rule: do not let two sessions edit `types/database.ts` / `sync-orders.ts` at once.

## Goal

A выезд (trip) can be created or changed **in Agbis** by the crew (e.g. driver reschedules, marks
done, or dispatch assigns a машина). Today CRM only pushes trips out (В1/В2) and never reads them
back, so `order_trips` drifts from Agbis. В3 closes the loop: pull Agbis trip state into
`order_trips` for CRM orders, so the order detail page reflects reality.

## What already exists (write side — do not duplicate)

- Table **`order_trips`** (`20260616000030_order_trips.sql`): one row per arm.
  Columns: `id, order_id (FK orders ON DELETE CASCADE), kind ('pickup'|'delivery'), address,
  agbis_car_id, agbis_trip_id, window_from, window_to, trip_date (date), sync_status
  ('pending'|'synced'|'failed'), sync_error, created_at, updated_at`. `UNIQUE(order_id, kind)`.
  RLS: admin all / manager own (via parent order). Writes are **service-role only**.
- `lib/agbis/order-trips.ts` — `TripKind`, `TRIP_KIND_TO_TYPE` (pickup→tp1, delivery→tp2),
  `armAgbisDate`. **Agbis tp ↔ kind mapping is here — reuse it, do not re-invent.**
- `lib/agbis/trips.ts` — `tripOrder` (create/edit/cancel via `id`+`mp_status`), `parseTripSlots`.
- `lib/agbis/push-trip.ts` — `pushTripForArm` (create), `syncArm` (create/edit/cancel). Write only.
- `orders.agbis_order_id` links a CRM order to its Agbis dor; trips belong to that order in Agbis.

## What В3 must do

1. **Find the read command.** There is **no documented "TripsByDateTime"/"GetTrips" command yet** —
   confirm with Agbis which command lists trips for a day / for an order (candidates near
   `TripsHr`, or trips embedded in `OrderByDateTimeForAll` / order detail). **This is the open
   unknown — resolve it first** (mark `???` in REGISTRY until confirmed). Do not assume a shape.
2. **Map Agbis trip → `order_trips` row** for orders the CRM owns (`orders.agbis_order_id` set):
   - `tp` (1/2) → `kind` via the inverse of `TRIP_KIND_TO_TYPE` (1→pickup, 2→delivery).
   - `TripID` → `agbis_trip_id`; address → `address`; car → `agbis_car_id`; hr/hr_to → window;
     date → `trip_date`; `mp_status` 2 (Отменён) → **delete** the row (mirror a cancel).
   - `sync_status = 'synced'` for rows confirmed present in Agbis.
3. **Reconcile, don't clobber:** upsert on `(order_id, kind)`. Only overwrite a row when the Agbis
   copy is authoritative (crew changed it). A CRM-side `sync_status='pending'/'failed'` arm that
   hasn't reached Agbis must **not** be wiped by the reader — skip rows with no `agbis_trip_id`.
4. **Where it runs:** extend the read-sync cron (`/api/cron/agbis`), not the write cron
   (`/api/cron/agbis-orders`, which drains outbox outward). Service role; idempotent.

## Conflict / ordering rules (write ↔ read)

- **Write wins in-flight, read wins at rest.** While `updateOrderTrips`/`pushTripForArm` is mid-push
  (row `pending`/`failed`, no `agbis_trip_id`), the reader skips it. Once an arm has `agbis_trip_id`
  (synced), Agbis is the source of truth and the reader may update address/car/window/cancel.
- **Cancel mirroring:** Agbis `mp_status=2` → delete the `order_trips` row (matches В2 cancel).
- **No FK orphans:** only sync trips for orders that exist in `orders` with a matching
  `agbis_order_id`. Ignore trips for imported `order_history` rows (no `order_trips` for history).

## Touch list (expected)

- `lib/agbis/sync-orders.ts` (or a new `sync-trips.ts`) — the reader + mapper. **Import-stream file.**
- `types/database.ts` — only if a migration is needed (none expected; `order_trips` already exists).
- REGISTRY.md — add the read flow + the confirmed Agbis list-trips command.

## Verification (Definition of Done)

- Create an order with a выезд in CRM (В1) → change its trip in Agbis (reschedule + a cancel) →
  run the read cron → `order_trips` reflects the Agbis change; `/orders/[id]` shows it.
- A `pending`/`failed` CRM arm (never reached Agbis) is left untouched by the reader.
- RLS unchanged; no new authenticated write path.

## Coordination

- Announce in the shared channel before editing `sync-orders.ts` / `types/database.ts`.
- The write stream will not touch `order_trips` schema further; В3 needs no write-side changes.
