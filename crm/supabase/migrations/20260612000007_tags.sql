-- Tags: общий справочник меток на команду (создал любой — видят все) + связка с клиентами.
-- Фильтр по тегам на /clients и /queue идёт через embed client_tags!inner.
--
-- DOWN (manual rollback):
--   drop table if exists public.client_tags;
--   drop table if exists public.tags;

create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint uq_tags_name unique (name),
  constraint chk_tags_name_len check (char_length(name) between 1 and 40)
);

create table if not exists public.client_tags (
  client_id  uuid not null references public.clients(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (client_id, tag_id)
);

create index if not exists idx_client_tags_tag on public.client_tags (tag_id);
create index if not exists idx_tags_created_by on public.tags (created_by);
create index if not exists idx_client_tags_created_by on public.client_tags (created_by);

alter table public.tags enable row level security;
alter table public.client_tags enable row level security;

-- Теги общие: читают и создают все авторизованные; удаляет создатель или админ.
create policy tags_select on public.tags for select to authenticated using (true);
create policy tags_insert on public.tags for insert to authenticated
  with check (created_by = auth.uid());
create policy tags_delete on public.tags for delete to authenticated
  using (created_by = auth.uid() or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Привязки: видят все, вешает/снимает любой авторизованный (команда 3-5 человек).
create policy client_tags_select on public.client_tags for select to authenticated using (true);
create policy client_tags_insert on public.client_tags for insert to authenticated
  with check (created_by = auth.uid());
create policy client_tags_delete on public.client_tags for delete to authenticated using (true);
