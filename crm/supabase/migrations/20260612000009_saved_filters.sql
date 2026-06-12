-- Сохранённые фильтры FilterBar: общие на команду (видят все), привязаны к странице.
-- conditions — массив условий {field, op, value}, валидируется на сервере (Zod + whitelist).
--
-- DOWN (manual rollback): drop table if exists public.saved_filters;

create table if not exists public.saved_filters (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  page       text not null check (page in ('clients', 'queue')),
  conditions jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint chk_saved_filters_name_len check (char_length(name) between 1 and 60),
  constraint uq_saved_filters_page_name unique (page, name)
);

create index if not exists idx_saved_filters_page on public.saved_filters (page);
create index if not exists idx_saved_filters_created_by on public.saved_filters (created_by);

alter table public.saved_filters enable row level security;

create policy saved_filters_select on public.saved_filters for select to authenticated using (true);
create policy saved_filters_insert on public.saved_filters for insert to authenticated
  with check (created_by = auth.uid());
create policy saved_filters_delete on public.saved_filters for delete to authenticated
  using (created_by = auth.uid() or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
