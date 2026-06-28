-- Durable broadcast queue (Variant B). The old broadcast was a CLIENT-side loop (useEffect +
-- setInterval in broadcasts/page.tsx) that DIED the moment the manager left the page → no real
-- background mode. This moves it server-side: a campaign snapshots its recipients (each with the
-- final text), a cron processor sends ~1/min (anti-ban) via the already-dynamic sendWhatsAppViaWazzup
-- (picks the live active Wazzup channel — works with whatever number is QR-connected), and a realtime
-- subscription on broadcast_campaigns drives a header progress widget. The manager clicks "send in
-- background" and is free to leave / make calls. Manual per-message mode (broadcast_logs) stays.
-- D-2026-06-28-crm-scope (broadcasts are core CRM scope). Created: 2026-06-29.
--
-- DOWN: drop functions settle_broadcast_recipient/claim_broadcast_recipients; drop tables
--   broadcast_recipients, broadcast_campaigns (cascade); remove from supabase_realtime publication.

begin;

-- Campaign: counters + status, realtime-published for the progress widget.
create table public.broadcast_campaigns (
  id             uuid primary key default gen_random_uuid(),
  created_by     uuid not null references public.profiles(id),
  status         text not null default 'running' check (status in ('running','paused','done','cancelled')),
  total          integer not null default 0 check (total >= 0),
  sent           integer not null default 0 check (sent >= 0),
  failed         integer not null default 0 check (failed >= 0),
  scenario_title text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Recipient queue: one row per client, with the FINAL text snapshotted at launch (so editing a
-- template later never changes an in-flight campaign). pending → claimed → sent/failed (terminal).
create table public.broadcast_recipients (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  client_id   uuid references public.clients(id),
  phone       text not null,
  text        text not null,
  status      text not null default 'pending' check (status in ('pending','claimed','sent','failed','skipped')),
  error       text,
  attempts    integer not null default 0,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_broadcast_recipients_campaign on public.broadcast_recipients (campaign_id);
create index idx_broadcast_recipients_pending on public.broadcast_recipients (created_at)
  where status in ('pending', 'claimed');

alter table public.broadcast_campaigns enable row level security;
alter table public.broadcast_recipients enable row level security;

-- All employees see broadcast progress (operational, same posture as deal_visibility 20260620000001).
-- All writes go through the service role (launch action + cron) — no authenticated write policy.
create policy broadcast_campaigns_select on public.broadcast_campaigns for select to authenticated using (true);
create policy broadcast_recipients_select on public.broadcast_recipients for select to authenticated using (true);

-- Realtime for the header progress widget (SELECT policy above is required for the subscription).
alter publication supabase_realtime add table public.broadcast_campaigns;

-- ============================================================
-- claim_broadcast_recipients — atomic FOR UPDATE SKIP LOCKED claim across all RUNNING campaigns.
-- Picks pending rows (and re-claims a 'claimed' row stuck >10 min from a crashed run). Marks claimed,
-- bumps attempts. ~1/min anti-ban is enforced by the caller (small p_limit per ~10-min cron run).
-- ============================================================
create or replace function public.claim_broadcast_recipients(
  p_limit      integer default 10,
  p_claimed_by text default 'cron'
)
returns table (id uuid, campaign_id uuid, client_id uuid, phone text, message text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select r.id
    from public.broadcast_recipients r
    join public.broadcast_campaigns c on c.id = r.campaign_id
    where c.status = 'running'
      and (r.status = 'pending' or (r.status = 'claimed' and r.claimed_at < now() - interval '10 minutes'))
    order by r.created_at asc
    limit greatest(p_limit, 0)
    for update of r skip locked
  )
  update public.broadcast_recipients r
  set status = 'claimed', claimed_at = now(), attempts = r.attempts + 1
  from due
  where r.id = due.id
  returning r.id, r.campaign_id, r.client_id, r.phone, r.text;
end;
$$;
revoke execute on function public.claim_broadcast_recipients(integer, text) from public, anon, authenticated;

-- ============================================================
-- settle_broadcast_recipient — mark one recipient sent/failed, then recompute the campaign counters
-- and flip it to 'done' once nothing is pending/claimed. No retry on failure (anti-ban: a failed send
-- is terminal; the operator can re-launch). Service role only.
-- ============================================================
create or replace function public.settle_broadcast_recipient(
  p_id      uuid,
  p_success boolean,
  p_error   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign uuid;
begin
  update public.broadcast_recipients
  set status     = case when p_success then 'sent' else 'failed' end,
      error      = case when p_success then null else p_error end,
      sent_at    = case when p_success then now() else null end,
      claimed_at = null
  where id = p_id
  returning campaign_id into v_campaign;
  if v_campaign is null then
    return;
  end if;

  update public.broadcast_campaigns c
  set sent       = (select count(*) from public.broadcast_recipients where campaign_id = v_campaign and status = 'sent'),
      failed     = (select count(*) from public.broadcast_recipients where campaign_id = v_campaign and status = 'failed'),
      status     = case
                     when c.status = 'running'
                          and not exists (
                            select 1 from public.broadcast_recipients
                            where campaign_id = v_campaign and status in ('pending', 'claimed')
                          )
                     then 'done'
                     else c.status
                   end,
      updated_at = now()
  where c.id = v_campaign;
end;
$$;
revoke execute on function public.settle_broadcast_recipient(uuid, boolean, text) from public, anon, authenticated;

commit;
