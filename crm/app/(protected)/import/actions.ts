'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/get-user-role'
import { requireAdmin } from '@/lib/auth/roles'
import type { ParsedImportOrder } from '@/types/order-history'

export type ClientRow = {
  name: string
  phone: string
  address: string | null
  total_orders: number
  total_spent: number
  avg_order_value: number
  last_order_date: string | null // ISO date
}

export type ImportResult = {
  created: number
  updated: number
  skipped: number
  errors: string[]
  ordersInserted: number
  zeroAmountOrders: number
  unmatchedOrders: number // телефон заказа не нашёлся среди клиентов
  batchId: string | null
}

const BATCH_SIZE = 500
// Чанк id для RPC пересчёта агрегатов — запас под лимит размера запроса (uuid[]).
const RECALC_RPC_CHUNK = 2000
const IMPORT_SOURCE = 'agbis_import'

type AdminClient = ReturnType<typeof createAdminClient>

function emptyResult(): ImportResult {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    ordersInserted: 0,
    zeroAmountOrders: 0,
    unmatchedOrders: 0,
    batchId: null,
  }
}

// Полный пересчёт агрегатов клиента из order_history (все source) + боевых orders.
// Считается одним SQL внутри RPC recalc_client_aggregates (security definer, зовётся
// только service role). Чанки по RECALC_RPC_CHUNK id — на случай лимита размера запроса.
async function recalcClientAggregates(
  admin: AdminClient,
  clientIds: string[]
): Promise<void> {
  if (clientIds.length === 0) return

  for (let i = 0; i < clientIds.length; i += RECALC_RPC_CHUNK) {
    const chunk = clientIds.slice(i, i + RECALC_RPC_CHUNK)
    const { error } = await admin.rpc('recalc_client_aggregates', {
      p_client_ids: chunk,
    })
    if (error) {
      console.error('[import.recalc] recalc_client_aggregates rpc', error)
      throw new Error('Ошибка пересчёта агрегатов')
    }
  }
}

export async function importClients(
  clients: ClientRow[],
  orders: ParsedImportOrder[] = []
): Promise<ImportResult> {
  const userSupabase = await createClient()
  const { data: { user } } = await userSupabase.auth.getUser()

  if (!user || getUserRole(user) !== 'admin') {
    return { ...emptyResult(), skipped: clients.length, errors: ['Доступ запрещен. Требуются права администратора.'] }
  }

  const adminSupabase = createAdminClient()
  const result = emptyResult()
  const batchId = crypto.randomUUID()
  result.batchId = batchId

  // 1. Список менеджеров для round-robin распределения новых клиентов.
  let managers: { id: string }[] = []
  try {
    const { data, error } = await userSupabase
      .from('profiles')
      .select('id')
      .neq('role', 'admin')
    if (!error && data) {
      managers = data
    }
  } catch (err) {
    console.error('Ошибка получения списка менеджеров для импорта:', err)
  }

  let managerIndex = 0

  // 2. Пакетный upsert клиентов + сбор phone → client_id по затронутым телефонам.
  const phoneToClientId = new Map<string, string>()
  const affectedClientIds = new Set<string>()

  for (let i = 0; i < clients.length; i += BATCH_SIZE) {
    const batch = clients.slice(i, i + BATCH_SIZE)
    const batchPhones = batch.map((c) => c.phone)

    // Сохраняем уже назначенных ответственных менеджеров.
    const existingMap = new Map<string, string | null>()
    try {
      const { data: existingClients } = await adminSupabase
        .from('clients')
        .select('phone, assigned_manager_id')
        .in('phone', batchPhones)

      existingClients?.forEach((ec) => {
        existingMap.set(ec.phone, ec.assigned_manager_id)
      })
    } catch (err) {
      console.error('Не удалось запросить существующих клиентов:', err)
    }

    const insertBatch = batch.map((c) => {
      let assignedManagerId = existingMap.get(c.phone)

      if (!assignedManagerId && managers.length > 0) {
        assignedManagerId = managers[managerIndex].id
        managerIndex = (managerIndex + 1) % managers.length
      }

      return {
        name: c.name,
        phone: c.phone,
        address: c.address,
        total_orders: c.total_orders,
        total_spent: c.total_spent,
        avg_order_value: c.avg_order_value,
        last_order_date: c.last_order_date,
        assigned_manager_id: assignedManagerId || null,
      }
    })

    const { data, error } = await adminSupabase
      .from('clients')
      .upsert(insertBatch, { onConflict: 'phone', ignoreDuplicates: false })
      .select('id, phone, created_at, updated_at')

    if (error) {
      result.errors.push(`Пакет ${i / BATCH_SIZE + 1}: ${error.message}`)
      result.skipped += batch.length
      continue
    }

    if (data) {
      for (const row of data) {
        phoneToClientId.set(row.phone, row.id)
        affectedClientIds.add(row.id)
        const created = new Date(row.created_at)
        const updated = new Date(row.updated_at)
        if (Math.abs(updated.getTime() - created.getTime()) < 1000) {
          result.created++
        } else {
          result.updated++
        }
      }
    }
  }

  // 3. Матчинг заказов по phone → client_id. normalizePhone применён в парсере,
  // upsert хранит phone в том же формате (+7XXXXXXXXXX) — сравнение по равенству.
  type HistoryInsert = {
    client_id: string
    order_date: string
    amount: number
    service: string | null
    address: string | null
    source: string
    import_batch_id: string
  }
  const historyRows: HistoryInsert[] = []
  for (const order of orders) {
    const clientId = phoneToClientId.get(order.phone)
    if (!clientId) {
      result.unmatchedOrders++
      continue
    }
    if (!order.order_date) {
      // Строки без даты не вставляем в историю (order_date NOT NULL).
      result.unmatchedOrders++
      continue
    }
    if (order.amount === 0) result.zeroAmountOrders++
    historyRows.push({
      client_id: clientId,
      order_date: order.order_date,
      amount: order.amount,
      service: order.service,
      address: order.address,
      source: IMPORT_SOURCE,
      import_batch_id: batchId,
    })
  }

  try {
    // 4. Идемпотентность: удаляем прежние agbis_import строки затронутых клиентов
    // (manual НЕ трогаем), затем вставляем новые батчами.
    const affectedArray = Array.from(affectedClientIds)
    for (let i = 0; i < affectedArray.length; i += BATCH_SIZE) {
      const chunk = affectedArray.slice(i, i + BATCH_SIZE)
      const { error: deleteError } = await adminSupabase
        .from('order_history')
        .delete()
        .eq('source', IMPORT_SOURCE)
        .in('client_id', chunk)
      if (deleteError) {
        console.error('[import] delete previous history', deleteError)
        throw new Error('Ошибка очистки прежней истории импорта')
      }
    }

    for (let i = 0; i < historyRows.length; i += BATCH_SIZE) {
      const chunk = historyRows.slice(i, i + BATCH_SIZE)
      const { error: insertError } = await adminSupabase
        .from('order_history')
        .insert(chunk)
      if (insertError) {
        console.error('[import] insert history', insertError)
        throw new Error('Ошибка вставки истории заказов')
      }
      result.ordersInserted += chunk.length
    }

    // 5. Пересчёт агрегатов затронутых клиентов (история всех source + боевые orders).
    await recalcClientAggregates(adminSupabase, affectedArray)
  } catch (err) {
    console.error('[import] orders/aggregates', err)
    result.errors.push('Ошибка обработки истории заказов')
  }

  return result
}

export type RollbackResult = {
  ok: boolean
  deleted: number
  error: string | null
}

// Откат конкретного импорта: удаляет строки по import_batch_id и пересчитывает
// агрегаты затронутых клиентов. Только admin.
export async function rollbackImport(batchId: string): Promise<RollbackResult> {
  const auth = await requireAdmin()
  if (!auth.ok) {
    return { ok: false, deleted: 0, error: auth.error }
  }

  const admin = createAdminClient()

  try {
    // Затронутые клиенты до удаления.
    const { data: rows, error: selectError } = await admin
      .from('order_history')
      .select('client_id')
      .eq('import_batch_id', batchId)
    if (selectError) {
      console.error('[import.rollback] select', selectError)
      return { ok: false, deleted: 0, error: 'Ошибка отката импорта' }
    }

    const affected = Array.from(new Set((rows ?? []).map((r) => r.client_id)))
    if (affected.length === 0) {
      return { ok: true, deleted: 0, error: null }
    }

    const { error: deleteError } = await admin
      .from('order_history')
      .delete()
      .eq('import_batch_id', batchId)
    if (deleteError) {
      console.error('[import.rollback] delete', deleteError)
      return { ok: false, deleted: 0, error: 'Ошибка отката импорта' }
    }

    await recalcClientAggregates(admin, affected)

    return { ok: true, deleted: rows?.length ?? 0, error: null }
  } catch (err) {
    console.error('[import.rollback]', err)
    return { ok: false, deleted: 0, error: 'Ошибка отката импорта' }
  }
}
