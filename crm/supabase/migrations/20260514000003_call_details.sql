-- Migration 003: Call details — sub_status, reason, next_call_time
-- Enables two-level disposition, decline reasons, scheduled callbacks
-- Created: 2026-05-14

-- Подстатус звонка (ordered, callback, decline_expensive, etc.)
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS sub_status text;

-- Причина отказа (свободный текст или код)
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS reason text;

-- Время перезвона (дополнение к next_call_date)
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS next_call_time time;

-- Индекс для быстрого поиска запланированных перезвонов
CREATE INDEX IF NOT EXISTS idx_call_logs_next_call
  ON public.call_logs (next_call_date, next_call_time)
  WHERE next_call_date IS NOT NULL;

-- Индекс для подсчёта попыток (3-strike rule)
CREATE INDEX IF NOT EXISTS idx_call_logs_client_status
  ON public.call_logs (client_id, status, created_at);
