import { createAdminClient } from '@/lib/supabase/admin'
import { saveOrderForAll, type SaveOrderService } from './write-commands'
import { getAgbisUserId } from './managers'
import { readBackOrder } from './order-readback'
import { ensureClientInAgbis } from './push-client'
import {
  AGBIS_PRICE_ID,
  AGBIS_NEW_STATUS_ID,
  AGBIS_NEW_STATUS_NAME,
  AGBIS_DEFAULT_SCLAD_ID,
} from './order-config'

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

async function enqueueOutbox(admin: AdminClient, orderId: string, scladId: string): Promise<void> {
  await admin.from('agbis_outbox').insert({
    entity: 'order',
    crm_id: orderId,
    op: 'create',
    payload: { sclad_id: scladId },
  })
}

async function markPending(
  admin: AdminClient,
  orderId: string,
  scladId: string,
  reason: string,
): Promise<PushResult> {
  await admin.from('orders').update({ sync_status: 'pending', sync_error: reason }).eq('id', orderId)
  await enqueueOutbox(admin, orderId, scladId)
  return { status: 'pending', reason }
}

async function markSynced(
  admin: AdminClient,
  orderId: string,
  dorId: string,
  scladId: string,
): Promise<void> {
  await admin
    .from('orders')
    .update({
      agbis_order_id: dorId,
      agbis_sclad_id: scladId,
      agbis_sclad_out_id: scladId,
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
 * the read-sync stream fills doc_num later. docDate keys the window (the order's intake date).
 */
async function backfillDocNum(admin: AdminClient, orderId: string, dorId: string, docDate: string): Promise<void> {
  try {
    const mirror = await readBackOrder(dorId, docDate)
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

async function logApi(admin: AdminClient, orderId: string, ok: boolean, dorId: string | null): Promise<void> {
  try {
    await admin.from('agbis_api_log').insert({
      command: 'SaveOrderForAll',
      op: 'create',
      crm_entity: 'order',
      crm_entity_id: orderId,
      error_code: ok ? 0 : 1,
      agbis_dor_id: dorId,
      billed: ok,
    })
  } catch {
    /* audit is best-effort — never fail the push because logging failed */
  }
}

export type PushOrderOpts = {
  scladId?: string
  managerEmail?: string | null
  docDate?: string // dd.mm.yyyy; defaults to today (Almaty)
  dateOut?: string | null // dd.mm.yyyy HH:MM:SS
  fastExec?: string | null // Agbis order_times id
}

export async function pushOrderToAgbis(
  orderId: string,
  opts: PushOrderOpts = {},
): Promise<PushResult> {
  const admin = createAdminClient()
  const scladId = opts.scladId || AGBIS_DEFAULT_SCLAD_ID

  const { data: order } = await admin
    .from('orders')
    .select('id, client_id, agbis_order_id')
    .eq('id', orderId)
    .single()
  if (!order) return { status: 'pending', reason: 'order_not_found' }
  if (order.agbis_order_id) return { status: 'synced', dorId: order.agbis_order_id }

  const { data: client } = await admin
    .from('clients')
    .select('agbis_client_id')
    .eq('id', order.client_id)
    .single()
  // Link (or create) the client in Agbis on demand — an unlinked client no longer blocks the push.
  let contrId = client?.agbis_client_id ?? null
  if (!contrId) {
    const linked = await ensureClientInAgbis(order.client_id)
    if (!linked.ok) return markPending(admin, orderId, scladId, 'client_not_linked')
    contrId = linked.agbisClientId
  }

  const { data: items } = await admin
    .from('order_items')
    .select('agbis_tovar_id, qty, kfx, discount_percent, addons')
    .eq('order_id', orderId)
  const services = buildOrderServices(items ?? [])
  if (!services.length) return markPending(admin, orderId, scladId, 'no_mappable_services')

  try {
    const { dorId } = await saveOrderForAll({
      contrId,
      scladId,
      scladOutId: scladId,
      priceId: AGBIS_PRICE_ID,
      statusId: AGBIS_NEW_STATUS_ID,
      docDate: opts.docDate || formatDocDate(),
      dateOut: opts.dateOut ?? null,
      fastExec: opts.fastExec ?? null,
      createrId: getAgbisUserId(opts.managerEmail),
      services,
    })
    await markSynced(admin, orderId, dorId, scladId)
    await backfillDocNum(admin, orderId, dorId, opts.docDate || formatDocDate())
    await logApi(admin, orderId, true, dorId)
    return { status: 'synced', dorId }
  } catch (err) {
    console.error('[agbis.pushOrder]', err)
    await logApi(admin, orderId, false, null)
    return markPending(admin, orderId, scladId, 'agbis_push_failed')
  }
}
