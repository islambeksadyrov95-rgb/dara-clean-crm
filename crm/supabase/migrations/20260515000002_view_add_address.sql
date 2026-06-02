-- Migration 005: Add address to client_segments view

DROP VIEW IF EXISTS public.client_segments;
CREATE VIEW public.client_segments AS
SELECT
  id, name, phone, address,
  total_orders, total_spent, last_order_date, last_called_at,
  locked_by, locked_until,
  CASE
    WHEN last_order_date IS NOT NULL AND (current_date - last_order_date) > 180 THEN 'Потерянный'
    WHEN last_order_date IS NOT NULL AND (current_date - last_order_date) > 90  THEN 'В риске'
    WHEN total_orders >= 4 THEN 'Постоянный'
    WHEN total_orders BETWEEN 2 AND 3 THEN 'Повторный'
    ELSE 'Новый'
  END AS rfm_segment,
  CASE
    WHEN last_order_date IS NOT NULL THEN (current_date - last_order_date)
    ELSE NULL
  END AS days_since_last_order
FROM public.clients;
