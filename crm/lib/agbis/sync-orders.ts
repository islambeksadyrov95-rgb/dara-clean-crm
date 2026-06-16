import { createAdminClient } from '@/lib/supabase/admin'
import { matchOrders, type ExistingHistoryRow } from './match'
import type { AgbisSyncOrder, AgbisSyncOrderService } from './sync-types'

/**
 * Order sync (read side, free of tariff) — ENRICH, not wipe (decision 2026-06-16).
 * Agbis orders are matched to the EXISTING order_history (filled by the prior Excel import)
 * one-to-one by (client + calendar date); matched rows are filled with the real amount /
 * dor_id / doc_num / who-created / status + per-service detail. Orders with no row to claim
 * are inserted. Surplus history rows are left untouched. Idempotent on agbis_dor_id (the
 * partial unique index is the DB-level guard); aggregates recomputed via the single source
 * of truth recalc_client_aggregates (D-2026-06-15-arch-history-target).
 */

const HISTORY_SOURCE = 'agbis_import'
const SELECT_CHUNK = 500
const WRITE_CHUNK = 500
const RECALC_CHUNK = 2000
// GET/DELETE `.in()` on uuid lists go in the URL — 36-char uuids overflow the server's URL
// limit past ~300 (verified). Keep uuid `.in()` chunks small; POST/PATCH bodies are unaffected.
const ID_IN_CHUNK = 200

const nonNeg = (n: number | null): number => Math.max(0, Math.round(n ?? 0))
const pct = (n: number | null): number => Math.min(999.99, Math.max(0, n ?? 0))

/** Agbis order header → order_history mirror fields (amount clamped to the >= 0 CHECK). */
export function orderHistoryFields(order: AgbisSyncOrder): {
  amount: number
  agbis_dor_id: string
  agbis_doc_num: string | null
  agbis_user_name: string | null
  agbis_status_id: number | null
  agbis_status_name: string | null
  agbis_debet: number | null
  agbis_dolg: number | null
  agbis_date_out: string | null
  agbis_discount: number | null
} {
  return {
    amount: nonNeg(order.amount),
    agbis_dor_id: order.dorId,
    agbis_doc_num: order.docNum,
    agbis_user_name: order.userName,
    agbis_status_id: order.statusId,
    agbis_status_name: order.statusName,
    agbis_debet: order.debet,
    agbis_dolg: order.dolg,
    agbis_date_out: order.dateOut,
    agbis_discount: order.discount,
  }
}

/**
 * Amount to write when enriching an existing row: the Agbis sum if present, else KEEP the
 * existing amount. Never downgrade a positive sum to 0 (missing kredit must not lose money).
 */
export function enrichAmount(order: AgbisSyncOrder, existingAmount: number): number {
  const incoming = nonNeg(order.amount)
  return incoming > 0 ? incoming : existingAmount
}

/** Agbis service line → order_history_items row (money clamped, discount in [0, 999.99]). */
export function orderServiceItem(
  service: AgbisSyncOrderService,
  isProduct = false,
): {
  agbis_tovar_id: string | null
  name: string
  qty: number | null
  kfx: number | null
  unit_price: number
  line_amount: number
  discount_percent: number
  addons: null
  is_product: boolean
} {
  return {
    agbis_tovar_id: service.tovId,
    name: service.service,
    qty: service.qty,
    kfx: service.kfx,
    unit_price: nonNeg(service.price),
    line_amount: nonNeg(service.lineAmount),
    discount_percent: pct(service.discount),
    addons: null,
    is_product: isProduct,
  }
}

/** A before/after enrich pair surfaced in dry-run so a human can verify the recovered sums. */
export type OrderSverka = {
  agbisDorId: string
  orderDate: string
  oldAmount: number
  newAmount: number
  lineSum: number // Σ service line amounts — should match newAmount (header kredit)
  userName: string | null
  services: { name: string; lineAmount: number }[]
}

export type SyncOrdersResult = {
  enriched: number
  inserted: number
  skipped: number
  unlinked: number
  affectedClients: number
  batchId: string
  plannedInserts?: number // dry-run: how many new orders WOULD be inserted
  lineSumMismatches?: number // dry-run: orders where Σ lines ≠ header amount (data-quality flag)
  sample?: OrderSverka[] // dry-run: a few enrich pairs for human sverka
}

const LINE_SUM_TOLERANCE = 1 // tenge — rounding slack between Σ lines and header amount

function lineSumOf(order: AgbisSyncOrder): number {
  return [...order.services, ...order.products].reduce((sum, s) => sum + nonNeg(s.lineAmount), 0)
}

type AdminClient = ReturnType<typeof createAdminClient>
type UpdateOp = {
  rowId: string
  clientId: string
  orderDate: string
  order: AgbisSyncOrder
  existingAmount: number // current order_history.amount — never downgrade a positive sum to 0
}
type InsertOp = { clientId: string; orderDate: string; order: AgbisSyncOrder }
type ItemEntry = {
  orderHistoryId: string
  services: AgbisSyncOrderService[]
  products: AgbisSyncOrderService[]
}

async function loadClientByContrId(
  admin: AdminClient,
  contrIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < contrIds.length; i += SELECT_CHUNK) {
    const chunk = contrIds.slice(i, i + SELECT_CHUNK)
    const { data, error } = await admin
      .from('clients')
      .select('id, agbis_client_id')
      .in('agbis_client_id', chunk)
    if (error) throw new Error('Не удалось сопоставить клиентов Agbis')
    for (const row of data ?? []) if (row.agbis_client_id) map.set(row.agbis_client_id, row.id)
  }
  return map
}

async function loadExistingHistory(
  admin: AdminClient,
  clientIds: string[],
): Promise<{ byClient: Map<string, ExistingHistoryRow[]>; amountById: Map<string, number> }> {
  const byClient = new Map<string, ExistingHistoryRow[]>()
  const amountById = new Map<string, number>()
  for (let i = 0; i < clientIds.length; i += ID_IN_CHUNK) {
    const chunk = clientIds.slice(i, i + ID_IN_CHUNK)
    const { data, error } = await admin
      .from('order_history')
      .select('id, client_id, order_date, agbis_dor_id, amount')
      .in('client_id', chunk)
      .order('id', { ascending: true }) // deterministic one-to-one pairing across runs
    if (error) throw new Error('Не удалось загрузить историю заказов')
    for (const row of data ?? []) {
      const list = byClient.get(row.client_id) ?? []
      list.push({ id: row.id, orderDate: row.order_date, agbisDorId: row.agbis_dor_id })
      byClient.set(row.client_id, list)
      amountById.set(row.id, row.amount)
    }
  }
  return { byClient, amountById }
}

async function insertItems(admin: AdminClient, entries: ItemEntry[]): Promise<void> {
  const rows = entries.flatMap((e) => [
    ...e.services.map((s) => ({ order_history_id: e.orderHistoryId, ...orderServiceItem(s, false) })),
    ...e.products.map((p) => ({ order_history_id: e.orderHistoryId, ...orderServiceItem(p, true) })),
  ])
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const { error } = await admin.from('order_history_items').insert(rows.slice(i, i + WRITE_CHUNK))
    if (error) throw new Error('Не удалось сохранить позиции заказа')
  }
}

async function applyUpdates(admin: AdminClient, ops: UpdateOp[]): Promise<void> {
  if (ops.length === 0) return
  const rows = ops.map((o) => {
    const fields = orderHistoryFields(o.order)
    // Never overwrite a positive sum with 0 (e.g. Agbis kredit missing on a re-sync) — the
    // whole point is to RECOVER money, not lose it.
    const amount = enrichAmount(o.order, o.existingAmount)
    return {
      id: o.rowId,
      client_id: o.clientId,
      order_date: o.orderDate,
      source: HISTORY_SOURCE,
      ...fields,
      amount,
    }
  })
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const { error } = await admin
      .from('order_history')
      .upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: 'id' })
    if (error) throw new Error('Не удалось обогатить историю заказов')
  }
  // Replace per-service detail for the updated rows (idempotent on re-sync).
  const rowIds = ops.map((o) => o.rowId)
  for (let i = 0; i < rowIds.length; i += ID_IN_CHUNK) {
    const { error } = await admin
      .from('order_history_items')
      .delete()
      .in('order_history_id', rowIds.slice(i, i + ID_IN_CHUNK))
    if (error) throw new Error('Не удалось обновить позиции заказа')
  }
  await insertItems(
    admin,
    ops.map((o) => ({
      orderHistoryId: o.rowId,
      services: o.order.services,
      products: o.order.products,
    })),
  )
}

type HistoryInsertRow = {
  client_id: string
  order_date: string
  service: string | null
  source: string
  import_batch_id: string
  amount: number
  agbis_dor_id: string
  agbis_doc_num: string | null
  agbis_user_name: string | null
  agbis_status_id: number | null
  agbis_status_name: string | null
  agbis_debet: number | null
  agbis_dolg: number | null
  agbis_date_out: string | null
  agbis_discount: number | null
}

type InsertedRef = { id: string; agbis_dor_id: string | null }

/**
 * Insert a chunk; if a dor_id already exists (overlapping window / re-run), the unique index
 * fires 23505 — degrade to row-by-row and SKIP the already-imported ones (idempotent), instead
 * of throwing and wedging the cursor. (matchOrders normally routes existing dor_ids to resync;
 * this is the safety net for overlap/concurrency.)
 */
async function insertHistoryRows(
  admin: AdminClient,
  chunk: HistoryInsertRow[],
): Promise<InsertedRef[]> {
  const res = await admin.from('order_history').insert(chunk).select('id, agbis_dor_id')
  if (!res.error) return res.data ?? []
  if (res.error.code !== '23505') throw new Error('Не удалось импортировать новые заказы')

  const out: InsertedRef[] = []
  for (const row of chunk) {
    const one = await admin.from('order_history').insert(row).select('id, agbis_dor_id')
    if (one.error?.code === '23505') continue // already imported — skip
    if (one.error) throw new Error('Не удалось импортировать новые заказы')
    out.push(...(one.data ?? []))
  }
  return out
}

async function applyInserts(
  admin: AdminClient,
  ops: InsertOp[],
  batchId: string,
): Promise<number> {
  if (ops.length === 0) return 0
  const dorToOrder = new Map(ops.map((o) => [o.order.dorId, o.order]))
  const rows: HistoryInsertRow[] = ops.map((o) => ({
    client_id: o.clientId,
    order_date: o.orderDate,
    service: o.order.services[0]?.service ?? null,
    source: HISTORY_SOURCE,
    import_batch_id: batchId,
    ...orderHistoryFields(o.order),
  }))
  let inserted = 0
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const data = await insertHistoryRows(admin, rows.slice(i, i + WRITE_CHUNK))
    inserted += data.length
    await insertItems(
      admin,
      data.map((r) => {
        const ord = r.agbis_dor_id ? dorToOrder.get(r.agbis_dor_id) : undefined
        return { orderHistoryId: r.id, services: ord?.services ?? [], products: ord?.products ?? [] }
      }),
    )
  }
  return inserted
}

async function recalc(admin: AdminClient, clientIds: string[]): Promise<void> {
  for (let i = 0; i < clientIds.length; i += RECALC_CHUNK) {
    const { error } = await admin.rpc('recalc_client_aggregates', {
      p_client_ids: clientIds.slice(i, i + RECALC_CHUNK),
    })
    if (error) throw new Error('Ошибка пересчёта агрегатов')
  }
}

/** ENRICH a window of Agbis orders into CRM order_history. Read-only against Agbis. */
export async function syncOrders(
  orders: AgbisSyncOrder[],
  opts: { batchId?: string; dryRun?: boolean } = {},
): Promise<SyncOrdersResult> {
  const admin = createAdminClient()
  const batchId = opts.batchId ?? crypto.randomUUID()

  const contrIds = [...new Set(orders.map((o) => o.contrId))]
  const clientByContrId = await loadClientByContrId(admin, contrIds)

  // Group linked orders by CRM client; orders for unlinked clients are skipped (quarantine).
  const ordersByClient = new Map<string, AgbisSyncOrder[]>()
  let unlinked = 0
  for (const order of orders) {
    const clientId = clientByContrId.get(order.contrId)
    if (!clientId) {
      unlinked += 1
      continue
    }
    const list = ordersByClient.get(clientId) ?? []
    list.push(order)
    ordersByClient.set(clientId, list)
  }

  const { byClient: existingByClient, amountById } = await loadExistingHistory(admin, [
    ...ordersByClient.keys(),
  ])
  const rowDateById = new Map<string, string>()
  for (const rows of existingByClient.values()) for (const r of rows) rowDateById.set(r.id, r.orderDate)

  const updateOps: UpdateOp[] = []
  const insertOps: InsertOp[] = []
  let skipped = 0
  for (const [clientId, clientOrders] of ordersByClient) {
    const m = matchOrders(clientOrders, existingByClient.get(clientId) ?? [])
    for (const u of [...m.resyncs, ...m.enrich]) {
      const orderDate = rowDateById.get(u.rowId) ?? u.order.orderDate
      if (!orderDate) continue
      updateOps.push({
        rowId: u.rowId,
        clientId,
        orderDate,
        order: u.order,
        existingAmount: amountById.get(u.rowId) ?? 0,
      })
    }
    for (const o of m.inserts) {
      if (!o.orderDate) continue
      insertOps.push({ clientId, orderDate: o.orderDate, order: o })
    }
    skipped += m.skipped.length
  }

  const affected = [...ordersByClient.keys()]

  if (opts.dryRun) {
    const sample: OrderSverka[] = updateOps.slice(0, 5).map((o) => ({
      agbisDorId: o.order.dorId,
      orderDate: o.orderDate,
      oldAmount: o.existingAmount,
      newAmount: orderHistoryFields(o.order).amount,
      lineSum: lineSumOf(o.order),
      userName: o.order.userName,
      services: o.order.services.map((s) => ({ name: s.service, lineAmount: nonNeg(s.lineAmount) })),
    }))
    const lineSumMismatches = [...updateOps, ...insertOps]
      .map((o) => o.order)
      .filter((ord) => {
        const amount = nonNeg(ord.amount)
        return amount > 0 && Math.abs(lineSumOf(ord) - amount) > LINE_SUM_TOLERANCE
      }).length
    return {
      enriched: updateOps.length,
      inserted: 0,
      skipped,
      unlinked,
      affectedClients: affected.length,
      batchId,
      plannedInserts: insertOps.length,
      lineSumMismatches,
      sample,
    }
  }

  await applyUpdates(admin, updateOps)
  const inserted = await applyInserts(admin, insertOps, batchId)
  await recalc(admin, affected)

  return {
    enriched: updateOps.length,
    inserted,
    skipped,
    unlinked,
    affectedClients: affected.length,
    batchId,
  }
}
