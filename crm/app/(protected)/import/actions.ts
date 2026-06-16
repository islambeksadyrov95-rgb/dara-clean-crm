'use server'

import { createAdminClient } from '@/lib/supabase/admin'
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
  unmatchedOrders: number
  batchId: string | null
}

// Чанк id для RPC пересчёта агрегатов — запас под лимит размера запроса (uuid[]).
const RECALC_RPC_CHUNK = 2000

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
// Оставлен для rollbackImport. Чанки по RECALC_RPC_CHUNK id — на случай лимита размера запроса.
async function recalcClientAggregates(admin: AdminClient, clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return

  for (let i = 0; i < clientIds.length; i += RECALC_RPC_CHUNK) {
    const chunk = clientIds.slice(i, i + RECALC_RPC_CHUNK)
    const { error } = await admin.rpc('recalc_client_aggregates', { p_client_ids: chunk })
    if (error) {
      console.error('[import.recalc] recalc_client_aggregates rpc', error)
      throw new Error('Ошибка пересчёта агрегатов')
    }
  }
}

/**
 * RETIRED (D2, 2026-06-16): order_history теперь принадлежит синхронизации Agbis API
 * (ENRICH; app/api/cron/agbis). Старый Excel-upsert удалял свои agbis_import-строки
 * затронутых клиентов и переставлял их — это затёрло бы восстановленные суммы /
 * agbis_dor_id / услуги. Оставлено как no-op guard, чтобы устаревший UI-вызов НЕ мог
 * испортить обогащённые данные. Откат старых батчей — через rollbackImport.
 */
export async function importClients(
  clients: ClientRow[],
  orders: ParsedImportOrder[] = [],
): Promise<ImportResult> {
  void orders // параметр сохранён ради совместимости сигнатуры с UI
  return {
    ...emptyResult(),
    skipped: clients.length,
    errors: ['Excel-импорт отключён: данные синхронизируются через Agbis API.'],
  }
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
    // Затронутые клиенты до удаления. Обогащённые Agbis-строки (agbis_dor_id IS NOT NULL)
    // НЕ откатываем — в них восстановленные суммы/услуги; откат — только «сырые» Excel-строки.
    const { data: rows, error: selectError } = await admin
      .from('order_history')
      .select('client_id')
      .eq('import_batch_id', batchId)
      .is('agbis_dor_id', null)
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
      .is('agbis_dor_id', null)
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
