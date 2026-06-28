import { createAdminClient } from '@/lib/supabase/admin'
import { AgbisTimeoutError } from './client'
import { saveOrderForAll, type SaveOrderResult, type SaveOrderService } from './write-commands'
import { getAgbisUserId } from './managers'
import { readBackOrder, findExistingOrderByContr } from './order-readback'
import { ensureClientInAgbis } from './push-client'
import {
  AGBIS_PRICE_ID,
  AGBIS_NEW_STATUS_ID,
  AGBIS_NEW_STATUS_NAME,
  AGBIS_DEFAULT_SCLAD_ID,
} from './order-config'
import type { Json } from '@/types/database'

/** Round-trip serialize to a provably-Json value (no `as` cast; mirrors lib/vpbx/events.ts). */
function toJson(value: unknown): Json {
  const serialized: string = JSON.stringify(value ?? null)
  const parsed: Json = JSON.parse(serialized)
  return parsed
}

/**
 * CRM → Agbis order push (v1: fixed-price services only; carpets/addons deferred).
 * Commit-then-push: the order already exists in CRM (via create_order_with_items) when this
 * runs. Safety net: any failure leaves the order in CRM as sync_status='pending' and enqueues
 * agbis_outbox — the order is never lost. Idempotent: a row already carrying agbis_order_id is
 * left untouched. Mirror updates use the service role (orders has no authenticated UPDATE policy).
 */

type AdminClient = ReturnType<typeof createAdminClient>
type LineItem = {
  agbis_tovar_id: string | null
  qty: number
  kfx: number | null
  discount_percent: number
  addons: unknown // jsonb: CarpetAddon[] for carpets, null for fixed services
}
export type PushResult =
  | { status: 'synced'; dorId: string }
  | { status: 'pending'; reason: string }

/** Almaty (UTC+5) calendar date as dd.mm.yyyy for Order.doc_date. */
export function formatDocDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/** Carpet addons stored as jsonb [{addon_id, values}] — pass through only well-formed entries. */
function readAddons(value: unknown): SaveOrderService['addons'] {
  if (!Array.isArray(value)) return undefined
  const out = value.flatMap((a) =>
    a && typeof a === 'object' && typeof (a as { addon_id?: unknown }).addon_id === 'string'
      ? [{ addon_id: String((a as { addon_id: string }).addon_id), values: String((a as { values?: unknown }).values ?? '') }]
      : [],
  )
  return out.length ? out : undefined
}

/**
 * order_items → Agbis services; rows without a catalog id are dropped (caller validates non-empty).
 * Carpets (addons present): count = kfx (area in m²); fixed services: count = qty. Agbis is
 * authoritative for the carpet price — we only send type + area via addons.
 */
export function buildOrderServices(items: readonly LineItem[]): SaveOrderService[] {
  return items
    .filter((it) => it.agbis_tovar_id)
    .map((it) => {
      const addons = readAddons(it.addons)
      return {
        tovarId: it.agbis_tovar_id as string,
        count: addons && it.kfx ? it.kfx : it.qty,
        discount: Number(it.discount_percent) || 0,
        ...(addons ? { addons } : {}),
      }
    })
}

/**
 * Enqueue the order for the reliability drain. PLAIN INSERT — НЕ upsert/onConflict. Индекс
 * uq_agbis_outbox_entity_crm_op ПАРТИАЛЬНЫЙ (WHERE entity='order'), а `ON CONFLICT (cols)` не
 * умеет вывести партиальный индекс без его предиката → upsert падал ошибкой 42P10, которую
 * старый код НЕ проверял (Supabase возвращает error, не бросает) → строка заказа никогда не
 * создавалась, и упавший заказ застревал pending без единого ретрая (0 order-строк в очереди
 * за всё время — доказано на проде). Партиальный uq-индекс по-прежнему держит «одна очередь
 * на заказ»: 23505 = уже в очереди → это норма. Любую другую ошибку логируем, не глотаем.
 */
async function enqueueOutbox(admin: AdminClient, orderId: string, scladId: string, scladOutId: string): Promise<void> {
  const { error } = await admin
    .from('agbis_outbox')
    .insert({ entity: 'order', crm_id: orderId, op: 'create', payload: { sclad_id: scladId, sclad_out_id: scladOutId } })
  if (error && error.code !== '23505') console.error('[agbis.enqueueOutbox]', error.message)
}

async function markPending(
  admin: AdminClient,
  orderId: string,
  sclad: { id: string; outId: string },
  reason: string,
): Promise<PushResult> {
  await admin.from('orders').update({ sync_status: 'pending', sync_error: reason }).eq('id', orderId)
  await enqueueOutbox(admin, orderId, sclad.id, sclad.outId)
  return { status: 'pending', reason }
}

async function markSynced(
  admin: AdminClient,
  orderId: string,
  dorId: string,
  sclad: { id: string; outId: string },
): Promise<void> {
  await admin
    .from('orders')
    .update({
      agbis_order_id: dorId,
      agbis_sclad_id: sclad.id,
      agbis_sclad_out_id: sclad.outId,
      agbis_price_id: AGBIS_PRICE_ID,
      agbis_status_id: AGBIS_NEW_STATUS_ID,
      agbis_status_name: AGBIS_NEW_STATUS_NAME,
      sync_status: 'synced',
      sync_error: null,
      agbis_synced_at: new Date().toISOString(),
    })
    .eq('id', orderId)
}

/**
 * Best-effort read-back of the human doc_num (№) right after create. SaveOrderForAll returns only
 * dor_id; the № and Agbis status come from re-reading the day window. Never fatal — if it misses,
 * the read-sync stream fills doc_num later. The window keys on the ENTRY date (today, Almaty) — NOT
 * the order's intake/doc_date: OrderByDateTimeForAll filters by when the order was ENTERED, so a
 * future-dated order (приём завтра) is found in today's window, not its intake-day window. Using
 * docDate here lost the № for every заказ на завтра (proven 2026-06-21).
 */
async function backfillDocNum(admin: AdminClient, orderId: string, dorId: string): Promise<void> {
  try {
    const mirror = await readBackOrder(dorId, formatDocDate())
    if (!mirror?.docNum) return
    await admin
      .from('orders')
      .update({
        agbis_doc_num: mirror.docNum,
        agbis_status_id: mirror.statusId ?? AGBIS_NEW_STATUS_ID,
        agbis_status_name: mirror.statusName ?? AGBIS_NEW_STATUS_NAME,
      })
      .eq('id', orderId)
  } catch (err) {
    console.error('[agbis.backfillDocNum]', err)
  }
}

type ApiLogEntry = {
  ok: boolean
  dorId: string | null
  contrId: string | null
  errorCode: number
  latencyMs: number | null
  request: Json | null
  response: Json | null
}

/**
 * Append a SaveOrderForAll audit row. Persisting the dor_id here BEFORE markSynced is the
 * recoverability guarantee: a crash between the Agbis commit and the CRM mirror write leaves the
 * dor_id in agbis_api_log, so the order is never silently double-created on the next drain.
 * error_code/latency/request/response are the REAL values (no more hardcoded 0/1). Best-effort —
 * audit failure never fails the push, but it is awaited so the row exists before markSynced.
 */
async function logApi(admin: AdminClient, orderId: string, entry: ApiLogEntry): Promise<void> {
  try {
    await admin.from('agbis_api_log').insert({
      command: 'SaveOrderForAll',
      op: 'create',
      crm_entity: 'order',
      crm_entity_id: orderId,
      http_status: entry.ok ? 200 : null,
      error_code: entry.errorCode,
      agbis_dor_id: entry.dorId,
      agbis_contr_id: entry.contrId,
      latency_ms: entry.latencyMs,
      billed: entry.ok,
      request: entry.request,
      response: entry.response,
    })
  } catch {
    /* audit is best-effort — never fail the push because logging failed */
  }
}

/**
 * Has this order been pushed (or attempted) to Agbis before? A prior SaveOrderForAll attempt means
 * Agbis MAY already hold the order even though the CRM never recorded a dor_id (commit-then-timeout).
 * On such a retry we MUST read-back before pushing again. First-ever pushes have no prior attempt,
 * so they push directly (a read-back there would risk a false match on an unrelated same-day order).
 */
async function hasPriorPushAttempt(admin: AdminClient, orderId: string): Promise<boolean> {
  const { count } = await admin
    .from('agbis_api_log')
    .select('id', { count: 'exact', head: true })
    .eq('crm_entity_id', orderId)
    .eq('command', 'SaveOrderForAll')
  return (count ?? 0) > 0
}

/**
 * Idempotent re-push guard. Returns:
 *  - {kind:'existing', dorId} — Agbis already holds this order → caller marks synced, no new order.
 *  - {kind:'blocked'}         — the read-back itself failed → caller must NOT push (would duplicate).
 *  - {kind:'clear'}           — safe to create the order (first push, or retry confirmed no order).
 */
type RepushGuard = { kind: 'existing'; dorId: string } | { kind: 'blocked' } | { kind: 'clear' }

async function guardRepush(admin: AdminClient, orderId: string, contrId: string, docDate: string): Promise<RepushGuard> {
  if (!(await hasPriorPushAttempt(admin, orderId))) return { kind: 'clear' }
  const probe = await findExistingOrderByContr(contrId, docDate)
  if (!probe.ok) return { kind: 'blocked' }
  if (probe.found) return { kind: 'existing', dorId: probe.found.dorId }
  return { kind: 'clear' }
}

export type PushOrderOpts = {
  scladId?: string
  scladOutId?: string // склад выдачи; по умолчанию = scladId (приём=выдача — боевой паттерн)
  managerEmail?: string | null
  docDate?: string // dd.mm.yyyy; defaults to today (Almaty)
  dateOut?: string | null // dd.mm.yyyy HH:MM:SS
  fastExec?: string | null // Agbis order_times id
  // Таймаут SaveOrderForAll. Inline-создание задаёт короткий (под maxDuration страницы 60с) —
  // при таймауте заказ остаётся pending+в очереди, а дренаж (cron, 300с) дотолкнёт с дефолтом 45с.
  writeTimeoutMs?: number
}

/** Resolve the Agbis contragent for the order's client, linking it on demand. */
async function resolveContrId(admin: AdminClient, clientId: string): Promise<string | null> {
  const { data: client } = await admin
    .from('clients')
    .select('agbis_client_id')
    .eq('id', clientId)
    .single()
  if (client?.agbis_client_id) return client.agbis_client_id
  const linked = await ensureClientInAgbis(clientId)
  return linked.ok ? linked.agbisClientId : null
}

type CreateCtx = {
  orderId: string
  contrId: string
  scladId: string
  scladOutId: string
  docDate: string
  services: readonly SaveOrderService[]
  opts: PushOrderOpts
}

/**
 * Create the order in Agbis, then persist in a recovery-safe order: audit (dor_id) FIRST, then the
 * orders mirror (markSynced), then the best-effort doc_num backfill. If markSynced crashed, the
 * dor_id is already in agbis_api_log AND Agbis read-back will find the order on the next drain — so
 * the order is never double-created. A push failure logs the real error and re-queues for retry.
 */
async function createAndPersist(admin: AdminClient, ctx: CreateCtx): Promise<PushResult> {
  let result: SaveOrderResult
  try {
    result = await saveOrderForAll({
      contrId: ctx.contrId,
      scladId: ctx.scladId,
      scladOutId: ctx.scladOutId,
      priceId: AGBIS_PRICE_ID,
      statusId: AGBIS_NEW_STATUS_ID,
      docDate: ctx.docDate,
      dateOut: ctx.opts.dateOut ?? null,
      fastExec: ctx.opts.fastExec ?? null,
      createrId: getAgbisUserId(ctx.opts.managerEmail),
      services: ctx.services,
      timeoutMs: ctx.opts.writeTimeoutMs,
    })
  } catch (err) {
    console.error('[agbis.pushOrder]', err)
    // Сохраняем КОНКРЕТНУЮ причину (код + текст Агбиса), а не общий 'agbis_push_failed'.
    // Таймаут НАШЕГО запроса — это не ошибка Агбиса: помечаем 'agbis_timeout', а не
    // ложный 'agbis_error_20' (DOMException ABORT_ERR.code===20, который и породил миф
    // про «ковёр без оценки»). Заказ мог реально создаться в Агбисе → дренаж сделает
    // read-back по contr_id (guardRepush) и не задвоит заказ.
    const code = errorCodeOf(err)
    const message = err instanceof Error ? err.message : String(err)
    const reason = err instanceof AgbisTimeoutError ? 'agbis_timeout' : `agbis_error_${code}`
    await logApi(admin, ctx.orderId, {
      ok: false, dorId: null, contrId: ctx.contrId, errorCode: code, latencyMs: null,
      request: null, response: toJson({ message }),
    })
    return markPending(admin, ctx.orderId, { id: ctx.scladId, outId: ctx.scladOutId }, reason)
  }
  await logApi(admin, ctx.orderId, {
    ok: true, dorId: result.dorId, contrId: ctx.contrId, errorCode: result.errorCode,
    latencyMs: result.latencyMs, request: toJson(result.request), response: toJson(result.response),
  })
  await markSynced(admin, ctx.orderId, result.dorId, { id: ctx.scladId, outId: ctx.scladOutId })
  await backfillDocNum(admin, ctx.orderId, result.dorId)
  return { status: 'synced', dorId: result.dorId }
}

/** Best-effort Agbis error code for the audit log (real code, not a hardcoded 0/1). */
function errorCodeOf(err: unknown): number {
  return err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'number'
    ? (err as { code: number }).code
    : 1
}

export async function pushOrderToAgbis(
  orderId: string,
  opts: PushOrderOpts = {},
): Promise<PushResult> {
  const admin = createAdminClient()
  const scladId = opts.scladId || AGBIS_DEFAULT_SCLAD_ID
  const scladOutId = opts.scladOutId || scladId // склад выдачи; fallback на приём (приём=выдача)
  const docDate = opts.docDate || formatDocDate()

  const { data: order } = await admin
    .from('orders')
    .select('id, client_id, agbis_order_id')
    .eq('id', orderId)
    .single()
  if (!order) return { status: 'pending', reason: 'order_not_found' }
  if (order.agbis_order_id) return { status: 'synced', dorId: order.agbis_order_id }

  const contrId = await resolveContrId(admin, order.client_id)
  if (!contrId) return markPending(admin, orderId, { id: scladId, outId: scladOutId }, 'client_not_linked')

  const { data: items } = await admin
    .from('order_items')
    .select('agbis_tovar_id, qty, kfx, discount_percent, addons')
    .eq('order_id', orderId)
  const services = buildOrderServices(items ?? [])
  if (!services.length) return markPending(admin, orderId, { id: scladId, outId: scladOutId }, 'no_mappable_services')

  // Idempotency: on a RE-push, confirm Agbis does not already hold this order before creating it.
  const guard = await guardRepush(admin, orderId, contrId, docDate)
  if (guard.kind === 'existing') {
    await markSynced(admin, orderId, guard.dorId, { id: scladId, outId: scladOutId })
    await backfillDocNum(admin, orderId, guard.dorId)
    return { status: 'synced', dorId: guard.dorId }
  }
  if (guard.kind === 'blocked') {
    // The read-back probe failed — pushing now could create a duplicate. Stay pending, retry later.
    return markPending(admin, orderId, { id: scladId, outId: scladOutId }, 'agbis_readback_unavailable')
  }

  return createAndPersist(admin, { orderId, contrId, scladId, scladOutId, docDate, services, opts })
}
