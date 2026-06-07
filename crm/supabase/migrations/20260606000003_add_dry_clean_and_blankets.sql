-- Migration: Add dry_clean_target and blankets_target columns to sales_plans
-- Created: 2026-06-06

alter table public.sales_plans
  add column if not exists dry_clean_target numeric(12,2) not null default 0,
  add column if not exists blankets_target numeric(12,2) not null default 0;
