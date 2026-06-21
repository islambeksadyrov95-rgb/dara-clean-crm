'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { getUserRole } from '@/lib/auth/get-user-role'
import { changeOrderStatus, type ChangeStatusResult } from '@/lib/agbis/write-commands'
import { AGBIS_STATUS, canCancelOrder, isTransitionAllowed, isValidStatusId } from '@/lib/agbis/order-status'
import { CancelOrderSchema } from './cancel-build'
import type { Json } from '@/types/database'

type AdminClient = ReturnType<typeof createAdminClient>
type OrderSource = 'crm' | 'history'

/** Round-trip serialize to a provably-Json value (no `as` cast; как в lib/agbis/push-order.ts). */
function toJson(value: unknown): Json {
  const parsed: Json = JSON.parse(JSON.stringify(value ?? null))
  return parsed
}

/**
 * Edit a CRM order's comment. The comment is CRM-local only — Agbis never receives it
 * (SaveOrderForAll sends Comments: []), so editing it cannot desync the order. Ownership is enforced
 * via RLS: the authed client only SELECTs its own orders; the write goes through admin because orders
 * has no authenticated UPDATE policy (see updateOrderTrips / persistFulfillment).
 */
export async function updateOrderComment(orderId: string, comment: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false as const, error: 'Не авторизован' }

  const { data: order } = await supabase.from('orders').select('id').eq('id', orderId).maybeSingle()
  if (!order) return { success: false as const, error: 'Заказ не найден' }

  const value = comment?.trim() || null
  const { error } = await createAdminClient().from('orders').update({ comment: value }).eq('id', orderId)
  if (error) {
    console.error('[updateOrderComment]', error)
    return { success: false as const, error: 'Не удалось сохранить комментарий' }
  }

  revalidatePath(`/orders/${orderId}`)
  return { success: true as const, comment: value }
}

export async function deleteOrder(orderId: string) {
  const supabase = await createClient()

  // 1. Проверка авторизации
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false as const, error: 'Не авторизован' }
  }

  // 2. Проверка роли (разрешено только админам)
  if (getUserRole(user) !== 'admin') {
    return { success: false as const, error: 'Доступ запрещен. Требуются права администратора.' }
  }

  // У таблицы orders нет DELETE RLS-политики, поэтому удаление под user-клиентом
  // молча затронуло бы 0 строк и вернуло фейковый success. Роль admin проверена
  // выше — выполняем удаление и пересчёт агрегатов под admin-клиентом (в обход RLS).
  const admin = createAdminClient()

  // 3. Получение информации об удаляемом заказе
  const { data: order, error: fetchError } = await admin
    .from('orders')
    .select('client_id')
    .eq('id', orderId)
    .single()

  if (fetchError || !order) {
    return {
      success: false as const,
      error: `Заказ не найден или ошибка при поиске: ${fetchError?.message || 'Неизвестная ошибка'}`,
    }
  }

  const clientId = order.client_id

  // 4. Удаление заказа (admin-клиент — см. примечание выше про отсутствие DELETE RLS)
  const { error: deleteError } = await admin
    .from('orders')
    .delete()
    .eq('id', orderId)

  if (deleteError) {
    return { success: false as const, error: `Ошибка при удалении заказа: ${deleteError.message}` }
  }

  // 5. Пересчёт агрегатов клиента ЕДИНЫМ источником правды — RPC recalc_client_aggregates.
  // Локальный recompute по одной таблице orders ошибочно зануляет/занижает lifetime-статистику:
  // реальная история клиента живёт ещё и в order_history (импорт Agbis/Excel), а от неё зависит
  // RFM-сегмент. RPC объединяет orders ∪ order_history с дедупом Agbis-зеркал (D-2026-06-16),
  // так что после удаления одного CRM-заказа агрегаты остаются корректными.
  const { error: recalcError } = await admin.rpc('recalc_client_aggregates', {
    p_client_ids: [clientId],
  })

  if (recalcError) {
    console.error('[deleteOrder] recalc_client_aggregates rpc', recalcError)
    return {
      success: false as const,
      error: 'Заказ удалён, но не удалось обновить статистику клиента',
    }
  }

  // Инвалидируем кэш для обновления интерфейса
  revalidatePath('/(protected)/orders')
  revalidatePath('/(protected)/clients')

  return { success: true as const }
}

async function loadOrderForStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  source: OrderSource,
): Promise<{ dorId: string | null; statusName: string | null } | null> {
  if (source === 'crm') {
    const { data } = await supabase
      .from('orders').select('id, agbis_order_id, agbis_status_name').eq('id', orderId).maybeSingle()
    return data ? { dorId: data.agbis_order_id, statusName: data.agbis_status_name } : null
  }
  const { data } = await supabase
    .from('order_history').select('id, agbis_dor_id, agbis_status_name').eq('id', orderId).maybeSingle()
  return data ? { dorId: data.agbis_dor_id, statusName: data.agbis_status_name } : null
}

async function logStatusApi(
  admin: AdminClient, orderId: string, dorId: string, r: ChangeStatusResult,
): Promise<void> {
  try {
    await admin.from('agbis_api_log').insert({
      command: 'ChangeStatusOrdersForAll', op: 'update', crm_entity: 'order', crm_entity_id: orderId,
      http_status: r.errorCode === 0 ? 200 : null, error_code: r.errorCode,
      agbis_dor_id: dorId, latency_ms: r.latencyMs, billed: r.errorCode === 0,
      request: toJson(r.request), response: toJson(r.response),
    })
  } catch {
    /* audit best-effort — лог не должен ронять смену статуса */
  }
}

/**
 * Сменить статус заказа и запушить в Агбис (ChangeStatusOrdersForAll). Работает и для CRM-заказов
 * (orders), и для импортированных (order_history) — у обоих есть agbis_dor_id и зеркало статуса.
 * RLS: загрузка под user-клиентом (видит только доступные заказы); зеркало пишется admin-клиентом
 * (у таблиц нет authenticated UPDATE-политики, как и для комментария). Идемпотентно по статусу.
 */
export async function updateOrderStatus(orderId: string, source: OrderSource, newStatusId: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false as const, error: 'Не авторизован' }
  if (!isValidStatusId(newStatusId)) return { success: false as const, error: 'Некорректный статус' }

  const order = await loadOrderForStatus(supabase, orderId, source)
  if (!order) return { success: false as const, error: 'Заказ не найден' }
  if (!order.dorId) return { success: false as const, error: 'Заказ не синхронизирован с Агбисом' }
  if (!isTransitionAllowed(order.statusName, newStatusId)) {
    return { success: false as const, error: 'Недопустимый переход статуса' }
  }

  let result: ChangeStatusResult
  try {
    result = await changeOrderStatus(order.dorId, newStatusId)
  } catch (err) {
    console.error('[updateOrderStatus] agbis', err)
    return { success: false as const, error: 'Ошибка связи с Агбисом' }
  }

  const admin = createAdminClient()
  await logStatusApi(admin, orderId, order.dorId, result)
  if (result.errorCode !== 0) return { success: false as const, error: 'Агбис отклонил смену статуса' }

  const newName = AGBIS_STATUS[newStatusId]
  const patch = { agbis_status_id: newStatusId, agbis_status_name: newName }
  const { error: upErr } = source === 'crm'
    ? await admin.from('orders').update(patch).eq('id', orderId)
    : await admin.from('order_history').update(patch).eq('id', orderId)
  if (upErr) console.error('[updateOrderStatus] mirror', upErr) // Агбис сменил — read-sync поправит

  revalidatePath(`/orders/${orderId}`)
  return { success: true as const, statusName: newName }
}

/**
 * Запросить отмену CRM-заказа. НЕ зовёт Агбис (публичный REST не умеет отмену-с-занулением, см.
 * CANCEL-FEATURE-RND.md) — пишет CRM-намерение cancel_requested, локальный binding/agent.py
 * исполняет сырую Firebird-отмену и зеркалит статус. Только неоплаченные активные: agbis_debet —
 * зеркало с лагом, поэтому это лишь UI/первичный гард; агент авторитетно перепроверяет живой DEBET.
 * RLS: загрузка под user-клиентом; запись admin-клиентом (у orders нет authenticated UPDATE).
 */
export async function cancelOrder(orderId: string, reason: number, comment: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false as const, error: 'Не авторизован' }

  const parsed = CancelOrderSchema.safeParse({ orderId, reason, comment })
  if (!parsed.success) return { success: false as const, error: 'Некорректные данные отмены' }

  const { data: order } = await supabase
    .from('orders')
    .select('id, agbis_order_id, agbis_status_name, agbis_debet, cancel_requested, cancelled_at')
    .eq('id', parsed.data.orderId).maybeSingle()
  if (!order) return { success: false as const, error: 'Заказ не найден' }
  if (!order.agbis_order_id) return { success: false as const, error: 'Заказ не синхронизирован с Агбисом' }
  if (order.cancel_requested || order.cancelled_at) return { success: false as const, error: 'Отмена уже запрошена' }

  const isUnpaid = order.agbis_debet === null || order.agbis_debet === 0
  if (!canCancelOrder(order.agbis_status_name, isUnpaid)) {
    return { success: false as const, error: 'Заказ нельзя отменить (оплачен, выдан или уже отменён)' }
  }

  const { error } = await createAdminClient().from('orders').update({
    cancel_requested: true,
    cancel_reason: parsed.data.reason,
    cancel_comment: parsed.data.comment?.trim() || null,
    cancelled_by: user.id,
  }).eq('id', parsed.data.orderId)
  if (error) {
    console.error('[cancelOrder]', error)
    return { success: false as const, error: 'Не удалось запросить отмену' }
  }

  revalidatePath(`/orders/${orderId}`)
  return { success: true as const }
}
