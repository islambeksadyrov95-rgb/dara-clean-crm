-- Бизнес-правило (D-2026-06-20): всё, что связано со сделкой клиента — история
-- звонков и заказы — видно КАЖДОМУ сотруднику, а не только тому, кто их создал.
-- Менеджеры работают по общей базе клиентов (clients уже видны всем). Расширяем
-- SELECT для роли manager с «только свои» (manager_id = auth.uid()) до «все».
--
-- Политики role-based (role = 'manager'): новые менеджеры покрываются автоматически,
-- без правок кода и без перечисления id.
--
-- Безопасность метрик: персональные показатели (motivation/*) фильтруют manager_id
-- ЯВНО в запросах, а не через RLS. Расширение снимает только потолок видимости и
-- не меняет персональные цифры. Агрегаты команды/воронки читают все строки и так
-- (admin-роль или admin-клиент).

-- ── call_logs ───────────────────────────────────────────────────────────────
drop policy if exists "manager can select own call_logs" on public.call_logs;
drop policy if exists "manager can select all call_logs" on public.call_logs;
create policy "manager can select all call_logs" on public.call_logs
  as permissive for select to authenticated
  using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager'::text));

-- ── orders ──────────────────────────────────────────────────────────────────
drop policy if exists "manager can select own orders" on public.orders;
drop policy if exists "manager can select all orders" on public.orders;
create policy "manager can select all orders" on public.orders
  as permissive for select to authenticated
  using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager'::text));

-- ── vpbx_calls (политика про неназначенные входящие больше не нужна — всё видно) ─
drop policy if exists "manager can select own vpbx_calls" on public.vpbx_calls;
drop policy if exists "manager can select unassigned inbound vpbx_calls" on public.vpbx_calls;
drop policy if exists "manager can select all vpbx_calls" on public.vpbx_calls;
create policy "manager can select all vpbx_calls" on public.vpbx_calls
  as permissive for select to authenticated
  using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager'::text));
