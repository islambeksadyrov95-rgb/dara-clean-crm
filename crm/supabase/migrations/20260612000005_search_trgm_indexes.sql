-- Поиск клиентов в getClientsList идёт через ilike '%term%' по name и phone.
-- btree-индексы такие запросы не ускоряют (ведущий wildcard) — нужен GIN + pg_trgm.
-- Ускоряет и сам поиск, и count(*) при активном фильтре поиска.

create extension if not exists pg_trgm;

create index if not exists idx_clients_name_trgm
  on public.clients using gin (name gin_trgm_ops);

create index if not exists idx_clients_phone_trgm
  on public.clients using gin (phone gin_trgm_ops);
