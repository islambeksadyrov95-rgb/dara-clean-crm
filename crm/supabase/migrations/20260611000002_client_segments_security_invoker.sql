-- Migration: enforce RLS on the client_segments view
-- Problem: client_segments was created without security_invoker, so it executes with
-- the view owner's privileges and BYPASSES the clients RLS policy. A manager querying
-- the view (e.g. on the broadcasts page) saw EVERY client in the database instead of
-- only their assigned clients — a cross-manager PII leak (name, phone, address).
--
-- Fix: security_invoker = true makes the view run with the querying role's privileges,
-- so the underlying clients RLS ("assigned_manager_id = auth.uid() OR admin") applies.
-- Admin and service_role paths are unaffected (they bypass RLS anyway).
-- Reversible: ALTER VIEW public.client_segments SET (security_invoker = false);
-- Created: 2026-06-11

alter view public.client_segments set (security_invoker = true);
