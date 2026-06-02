-- Migration 006: Call transcripts, AI scoring
-- Stores live transcript text, LLM summary, and sales effectiveness score

ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS transcript text;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS call_score integer;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS call_duration integer;
