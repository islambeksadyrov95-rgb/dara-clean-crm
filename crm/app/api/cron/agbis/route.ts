import { createAdminClient } from '@/lib/supabase/admin'
import { clientsByDateTimeForAll, orderByDateTimeForAll } from '@/lib/agbis/commands'
import { withUserSession } from '@/lib/agbis/run'
import { syncClients } from '@/lib/agbis/sync-clients'
import { syncOrders } from '@/lib/agbis/sync-orders'
import { drainPendingOrders, drainPendingTrips } from '@/lib/agbis/drain-orders'
import { drainBroadcasts } from '@/lib/broadcasts/drain'
import { generateHalfMonthWindows, incrementalWindow, type DateWindow } from '@/lib/agbis/windows'

/**
 * Agbis read-side sync driver (free of tariff — D-2026-06-15-arch-tariff-reads-free).
 * Authorized by CRON_SECRET (Authorization: Bearer <secret>), like the VPBX cron.
 *
 *   ?mode=dry-run&entity=orders&start=2026-05-01&stop=2026-05-15  — preview, NO writes (sverka)
 *   ?mode=backfill&entity=all&start=2024-01-01                    — one-time tile of all windows
 *   ?mode=increment&entity=all                                    — window since the saved cursor
 *
 * Backfill links/imports clients FIRST, then ENRICHes orders (B14), and only flips the
 * agbis_sync_state cursor + backfilled flag once a full pass completes.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_BACKFILL_START = '2024-01-01'
const ALMATY_TZ = 'Asia/Almaty'
const MODES = new Set(['dry-run', 'backfill', 'increment'])
const ENTITIES = new Set(['clients', 'orders', 'all'])
const YMD = /^\d{4}-\d{2}-\d{2}$/

type AdminClient = ReturnType<typeof createAdminClient>

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? '').trim()
  return secret !== '' && req.headers.get('authorization') === `Bearer ${secret}`
}

/** Current date as yyyy-mm-dd in Almaty (en-CA formats as ISO date). */
function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ALMATY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

const fetchClients = (window: DateWindow) =>
  withUserSession((sid) => clientsByDateTimeForAll(window, sid))
const fetchOrders = (window: DateWindow) =>
  withUserSession((sid) => orderByDateTimeForAll(window, sid))

async function writeState(
  admin: AdminClient,
  entity: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString()
  await admin
    .from('agbis_sync_state')
    .upsert({ entity, last_run_at: now, updated_at: now, ...patch })
}

async function backfillClients(admin: AdminClient, startYmd: string): Promise<unknown> {
  const windows = generateHalfMonthWindows(startYmd, todayYmd())
  const totals = { created: 0, linked: 0, quarantined: 0, windows: windows.length }
  for (const window of windows) {
    const result = await syncClients(await fetchClients(window))
    totals.created += result.created
    totals.linked += result.linked
    totals.quarantined += result.quarantined
  }
  await writeState(admin, 'clients', {
    last_synced_at: new Date().toISOString(),
    backfilled: true,
    last_status: 'ok',
    last_error: null,
  })
  return totals
}

async function backfillOrders(admin: AdminClient, startYmd: string): Promise<unknown> {
  const windows = generateHalfMonthWindows(startYmd, todayYmd())
  const totals = { enriched: 0, inserted: 0, skipped: 0, unlinked: 0, windows: windows.length }
  for (const window of windows) {
    const result = await syncOrders(await fetchOrders(window))
    totals.enriched += result.enriched
    totals.inserted += result.inserted
    totals.skipped += result.skipped
    totals.unlinked += result.unlinked
  }
  await writeState(admin, 'orders', {
    last_synced_at: new Date().toISOString(),
    backfilled: true,
    last_status: 'ok',
    last_error: null,
  })
  return totals
}

async function incrementEntity(admin: AdminClient, entity: 'clients' | 'orders'): Promise<unknown> {
  const { data } = await admin
    .from('agbis_sync_state')
    .select('last_synced_at, backfilled')
    .eq('entity', entity)
    .maybeSingle()
  if (!data?.last_synced_at) return { entity, error: 'no_cursor — run backfill first' }
  // One timestamp for BOTH the window end and the saved cursor — no gap where changes are missed.
  const nowIso = new Date().toISOString()
  const window = incrementalWindow(data.last_synced_at, nowIso)
  if (!window) return { entity, error: 'bad_cursor' }
  const result =
    entity === 'clients'
      ? await syncClients(await fetchClients(window))
      : await syncOrders(await fetchOrders(window))
  await writeState(admin, entity, { last_synced_at: nowIso, last_status: 'ok', last_error: null })
  return { entity, ...result }
}

async function dryRun(
  entity: string,
  startYmd: string,
  stopYmd: string,
): Promise<Record<string, unknown>> {
  const windows = generateHalfMonthWindows(startYmd, stopYmd)
  if (entity === 'clients') {
    const clients = (await Promise.all(windows.map(fetchClients))).flat()
    return { entity, window: { startYmd, stopYmd }, fetched: clients.length, ...(await syncClients(clients, { dryRun: true })) }
  }
  const orders = (await Promise.all(windows.map(fetchOrders))).flat()
  return { entity, window: { startYmd, stopYmd }, fetched: orders.length, ...(await syncOrders(orders, { dryRun: true })) }
}

async function runBackfill(admin: AdminClient, entity: string, start: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  if (entity === 'clients' || entity === 'all') out.clients = await backfillClients(admin, start)
  if (entity === 'orders' || entity === 'all') out.orders = await backfillOrders(admin, start)
  return out
}

/**
 * Piggyback the order-outbox drain on the reliable read-sync trigger (cron-job.org, ~10 min). The
 * dedicated /api/cron/agbis-orders is only daily in vercel.json (Hobby) — far too slow for order
 * recovery and async-durable push. Running it here makes recovery ~10 min with no extra trigger.
 * Best-effort: a write-side failure must NOT fail the read-side sync. D-2026-06-28-drain-piggyback.
 */
async function drainOutbox(): Promise<unknown> {
  try {
    const [orders, trips] = await Promise.all([drainPendingOrders(50), drainPendingTrips(50)])
    return { orders, trips }
  } catch (err) {
    console.error('[agbis-cron.drain]', (err as Error).message)
    return { error: 'drain_failed' }
  }
}

/** Piggyback the broadcast queue on the same ~10-min trigger (no extra cron). Best-effort. */
async function drainBroadcastQueue(): Promise<unknown> {
  try {
    return await drainBroadcasts()
  } catch (err) {
    console.error('[agbis-cron.broadcasts]', (err as Error).message)
    return { error: 'broadcasts_drain_failed' }
  }
}

async function runIncrement(admin: AdminClient, entity: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  if (entity === 'clients' || entity === 'all') out.clients = await incrementEntity(admin, 'clients')
  if (entity === 'orders' || entity === 'all') out.orders = await incrementEntity(admin, 'orders')
  out.drain = await drainOutbox() // every read-sync run also drains the CRM→Agbis outbox
  out.broadcasts = await drainBroadcastQueue() // …and the WhatsApp broadcast queue
  return out
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return Response.json({ ok: false }, { status: 401 })

  const params = new URL(req.url).searchParams
  const mode = params.get('mode') ?? 'increment'
  const entity = params.get('entity') ?? 'all'
  const start = params.get('start') ?? DEFAULT_BACKFILL_START
  const stop = params.get('stop') ?? todayYmd()
  if (!MODES.has(mode) || !ENTITIES.has(entity)) {
    return Response.json({ ok: false, error: 'invalid mode/entity' }, { status: 400 })
  }
  if ((mode === 'backfill' || mode === 'dry-run') && (!YMD.test(start) || !YMD.test(stop))) {
    return Response.json({ ok: false, error: 'invalid date — expected yyyy-mm-dd' }, { status: 400 })
  }

  const admin = createAdminClient()
  try {
    if (mode === 'dry-run') return Response.json({ ok: true, mode, ...(await dryRun(entity, start, stop)) })
    if (mode === 'backfill') return Response.json({ ok: true, mode, ...(await runBackfill(admin, entity, start)) })
    return Response.json({ ok: true, mode, ...(await runIncrement(admin, entity)) })
  } catch (err) {
    console.error('[agbis-cron]', (err as Error).message)
    return Response.json({ ok: false, error: 'sync_failed' }, { status: 500 })
  }
}
