-- Источник клиента («Откуда вы о нас узнали?»):
-- строгий справочник acquisition_sources (управляет админ, ИИ источники НЕ создаёт)
-- + у клиента: FK на источник и дословный ответ (acquisition_answer_raw).
-- Очередь разбора = клиенты с raw-ответом без источника (отдельной таблицы не нужно).
--
-- DOWN (manual rollback):
--   alter table public.clients drop column if exists acquisition_answer_raw,
--     drop column if exists acquisition_source_id;
--   drop table if exists public.acquisition_sources;

create table if not exists public.acquisition_sources (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- Подсказки-синонимы для ИИ-классификации («инста», «сторис» → Instagram)
  synonyms   text[] not null default '{}',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint uq_acquisition_sources_name unique (name),
  constraint chk_acquisition_sources_name_len check (char_length(name) between 1 and 60)
);

alter table public.acquisition_sources enable row level security;

-- Справочник строгий: читают все, меняет только админ.
create policy acq_sources_select on public.acquisition_sources for select to authenticated using (true);
create policy acq_sources_write on public.acquisition_sources for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Стартовый набор (idempotent).
insert into public.acquisition_sources (name, synonyms) values
  ('Instagram', '{инстаграм,инста,сторис,reels,директ}'),
  ('2GIS', '{2гис,дубльгис,два гис}'),
  ('Google', '{гугл,поиск,google maps,карты}'),
  ('Рекомендация', '{знакомые,подруга,друг,посоветовали,сарафан}'),
  ('WhatsApp-рассылка', '{рассылка,ватсап,whatsapp,сообщение от вас}'),
  ('Наружная реклама', '{вывеска,баннер,билборд,листовка}'),
  ('Повторный (база)', '{уже обращался,постоянный клиент}')
on conflict (name) do nothing;

alter table public.clients
  add column if not exists acquisition_source_id uuid references public.acquisition_sources(id) on delete set null,
  add column if not exists acquisition_answer_raw text;

create index if not exists idx_clients_acquisition_source on public.clients (acquisition_source_id);
