-- Migration 007: Sales plan settings
-- avg_check, plan_orders_per_day, plan_revenue_per_day, conversion_target

INSERT INTO public.crm_settings (key, value) VALUES
  ('sales_plan', '{
    "avg_check": 17000,
    "calls_per_day": 40,
    "target_conversion": 12,
    "plan_orders_per_day": 5,
    "plan_revenue_per_day": 85000
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
