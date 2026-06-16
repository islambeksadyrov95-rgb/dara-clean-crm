-- Intake date now carries time as well (date+time), matching delivery_date.
-- The order form captures the intake moment (auto-filled to "now" in Almaty), so we widen
-- orders.intake_date from `date` to `timestamptz` to preserve the wall-clock time.
-- Existing date-only rows convert to midnight (UTC) — acceptable, no manual backfill.
-- Agbis stays date-only on write (doc_date = dd.mm.yyyy); Agbis stamps doc_time itself on create.
-- Created: 2026-06-16
--
-- DOWN migration (manual rollback — note: time component is lost on the way back to `date`):
--   begin;
--   alter table public.orders
--     alter column intake_date type date using intake_date::date;
--   commit;

begin;

alter table public.orders
  alter column intake_date type timestamptz using intake_date::timestamptz;

commit;
