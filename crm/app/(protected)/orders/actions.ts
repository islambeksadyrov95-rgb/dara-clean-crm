'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { getUserRole } from '@/lib/auth/get-user-role'

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
