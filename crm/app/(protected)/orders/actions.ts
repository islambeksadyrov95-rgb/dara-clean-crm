'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

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
  const role = user.app_metadata?.role
  if (role !== 'admin') {
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

  // 5. Пересчет агрегатов для клиента
  const { data: remainingOrders, error: ordersError } = await admin
    .from('orders')
    .select('amount, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (ordersError) {
    return {
      success: false as const,
      error: `Заказ удален, но не удалось обновить статистику клиента: ${ordersError.message}`,
    }
  }

  if (!remainingOrders || remainingOrders.length === 0) {
    // Если у клиента не осталось заказов
    const { error: updateClientError } = await admin
      .from('clients')
      .update({
        total_orders: 0,
        total_spent: 0,
        avg_order_value: 0,
        last_order_date: null,
      })
      .eq('id', clientId)

    if (updateClientError) {
      console.error('Ошибка сброса агрегатов клиента:', updateClientError.message)
    }
  } else {
    // Если заказы остались
    const totalOrders = remainingOrders.length
    const totalSpent = remainingOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0)
    const avgOrderValue = Math.round((totalSpent / totalOrders) * 100) / 100
    
    // Форматируем дату последнего заказа в YYYY-MM-DD
    const lastOrderDateStr = remainingOrders[0].created_at
      ? new Date(remainingOrders[0].created_at).toISOString().split('T')[0]
      : null

    const { error: updateClientError } = await admin
      .from('clients')
      .update({
        total_orders: totalOrders,
        total_spent: totalSpent,
        avg_order_value: avgOrderValue,
        last_order_date: lastOrderDateStr,
      })
      .eq('id', clientId)

    if (updateClientError) {
      console.error('Ошибка обновления агрегатов клиента:', updateClientError.message)
    }
  }

  // Инвалидируем кэш для обновления интерфейса
  revalidatePath('/(protected)/orders')
  revalidatePath('/(protected)/clients')

  return { success: true as const }
}
