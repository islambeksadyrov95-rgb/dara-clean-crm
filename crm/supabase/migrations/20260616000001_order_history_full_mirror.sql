-- Agbis full order mirror: payment / debt / delivery date + product line items.
-- User decision 2026-06-16: capture Tovars (products) and payment/date fields, not just
-- services + total amount. Additive only (no data wiped). Money = integer tenge.
-- RLS already on both tables (oh_select/oh_write, ohi_select) and covers new columns.
-- Created: 2026-06-16
--
-- DOWN migration (manual rollback):
--   begin;
--   alter table public.order_history_items drop column if exists is_product;
--   alter table public.order_history
--     drop column if exists agbis_debet, drop column if exists agbis_dolg,
--     drop column if exists agbis_date_out, drop column if exists agbis_discount;
--   commit;

begin;

-- order_history — header payment/debt/delivery mirror (read-only from Agbis).
alter table public.order_history
  add column if not exists agbis_debet    integer,        -- paid amount (Agbis debet), whole tenge
  add column if not exists agbis_dolg     integer,        -- outstanding debt (Agbis dolg), whole tenge
  add column if not exists agbis_date_out date,           -- planned delivery date (Agbis date_out)
  add column if not exists agbis_discount numeric(12,2);  -- order-level discount (Agbis discount)

-- order_history_items — distinguish product lines (Tovars) from service lines (Srvices).
alter table public.order_history_items
  add column if not exists is_product boolean not null default false;

commit;
