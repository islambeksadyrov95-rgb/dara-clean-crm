-- Центр уведомлений — Фаза 1 (звонки).
-- Колокольчик в шапке: входящие (пропущенные / новые в отсутствие) копятся в БД и
-- приходят живьём по realtime, переживая перезагрузку и пропуски realtime у карточки
-- (best practice: тост на «звонит сейчас» + персистентный инбокс на остальное).
--
-- Что НЕ здесь: «пора перезвонить» (derive-on-read из clients.next_action_at, без хранения)
-- и «клиент написал в WhatsApp» (Фаза 2, нужен inbound-вебхук Wazzup).
--
-- DOWN (manual):
--   drop trigger if exists trg_notify_inbound_call on public.vpbx_calls;
--   drop function if exists public.fn_notify_inbound_call();
--   alter publication supabase_realtime drop table public.notifications;
--   drop table if exists public.notifications;
--
-- After apply: npm run gen:types (новая таблица notifications в Database).

begin;

-- ============================================================
-- 1. Таблица уведомлений
--    recipient_id = NULL → командное (входящий с неназначенного номера, виден всем менеджерам).
--    Coalescing: один непрочитанный тред на (получатель+клиент) через partial-unique по dedup_key.
-- ============================================================
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete cascade,
  type         text not null check (type in ('call_inbound')),
  subtype      text check (subtype in ('incoming', 'missed', 'answered')),
  client_id    uuid references public.clients(id) on delete cascade,
  call_id      uuid references public.vpbx_calls(id) on delete set null,
  phone        text,
  event_count  integer not null default 1 check (event_count >= 1),
  dedup_key    text not null,
  status       text not null default 'unread' check (status in ('unread', 'read')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists idx_notifications_feed
  on public.notifications (recipient_id, status, updated_at desc);
create index if not exists idx_notifications_client
  on public.notifications (client_id);
-- Один активный (непрочитанный) тред на dedup_key. dedup_key уже кодирует получателя/команду,
-- поэтому уникальность по одному столбцу (NULL recipient_id не мешает — он не в ключе).
create unique index if not exists uq_notifications_active
  on public.notifications (dedup_key) where status = 'unread';

-- ============================================================
-- 2. RLS — персонально: свои + командные (recipient NULL); админ видит всё.
--    INSERT нет для authenticated → пишет только триггер (service role/definer).
-- ============================================================
alter table public.notifications enable row level security;

create policy "see own or team notifications" on public.notifications
  for select to authenticated
  using (
    recipient_id = auth.uid()
    or recipient_id is null
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy "mark own or team notifications read" on public.notifications
  for update to authenticated
  using (
    recipient_id = auth.uid()
    or recipient_id is null
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    recipient_id = auth.uid()
    or recipient_id is null
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ============================================================
-- 3. Realtime publication (живой бейдж колокольчика)
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================
-- 4. Триггер: входящий звонок → уведомление ответственному менеджеру (или команде).
--    Срабатывает на INSERT и на смену finish_status — апдейты транскрибации/записи игнорируются.
--    event_count растёт только на НОВЫЙ звонок (call_id меняется), а не на каждое событие звонка.
-- ============================================================
create or replace function public.fn_notify_inbound_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtype text;
  v_key     text;
begin
  if NEW.direction <> 'inbound' then
    return NEW;
  end if;
  -- Только значимые переходы: создание строки или смена статуса завершения.
  if TG_OP = 'UPDATE' and NEW.finish_status is not distinct from OLD.finish_status then
    return NEW;
  end if;

  v_subtype := case
    when NEW.finish_status in ('NOT_ANSWERED', 'BUSY', 'CANCELLED') then 'missed'
    when NEW.finish_status = 'ANSWERED' then 'answered'
    else 'incoming'
  end;
  v_key := 'call_inbound:' || coalesce(NEW.manager_id::text, 'team')
           || ':' || coalesce(NEW.client_id::text, NEW.number_a, NEW.id::text);

  insert into public.notifications (recipient_id, type, subtype, client_id, call_id, phone, dedup_key)
  values (NEW.manager_id, 'call_inbound', v_subtype, NEW.client_id, NEW.id, NEW.number_a, v_key)
  on conflict (dedup_key) where status = 'unread'
  do update set
    event_count = notifications.event_count
      + (case when notifications.call_id is distinct from excluded.call_id then 1 else 0 end),
    subtype   = excluded.subtype,
    call_id   = excluded.call_id,
    client_id = coalesce(excluded.client_id, notifications.client_id),
    phone     = coalesce(excluded.phone, notifications.phone),
    updated_at = now();

  return NEW;
end;
$$;

drop trigger if exists trg_notify_inbound_call on public.vpbx_calls;
create trigger trg_notify_inbound_call
  after insert or update on public.vpbx_calls
  for each row execute function public.fn_notify_inbound_call();

commit;
