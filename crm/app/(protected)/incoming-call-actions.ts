'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Данные для карточки входящего звонка: клиент по номеру (если опознан вебхуком)
 * + его последний заказ, чтобы менеджер сразу видел кто звонит и где искать заказ.
 * Читаем под user-клиентом (RLS): событие realtime приходит ответственному менеджеру/админу.
 */

export type CallerCard = {
  client: { id: string; name: string; phone: string; totalOrders: number; lastOrderDate: string | null } | null
  recentOrder: { id: string; docNum: string | null; statusName: string | null; amount: number | null; createdAt: string } | null
}

export type CallerCardResult = { success: true; data: CallerCard } | { success: false; error: string }

export async function getCallerCard(clientId: string): Promise<CallerCardResult> {
  try {
    if (!clientId || typeof clientId !== 'string') {
      return { success: false, error: 'Не указан клиент' }
    }
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Не авторизован' }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, phone, total_orders, last_order_date')
      .eq('id', clientId)
      .maybeSingle()
    if (clientError) {
      console.error('[getCallerCard] client', clientError.message)
      return { success: false, error: 'Ошибка загрузки клиента' }
    }
    if (!client) return { success: true, data: { client: null, recentOrder: null } }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, agbis_doc_num, agbis_status_name, amount, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (orderError) console.error('[getCallerCard] order', orderError.message)

    return {
      success: true,
      data: {
        client: {
          id: client.id,
          name: client.name,
          phone: client.phone,
          totalOrders: client.total_orders ?? 0,
          lastOrderDate: client.last_order_date,
        },
        recentOrder: order
          ? { id: order.id, docNum: order.agbis_doc_num, statusName: order.agbis_status_name, amount: order.amount, createdAt: order.created_at }
          : null,
      },
    }
  } catch (err) {
    console.error('[getCallerCard]', err)
    return { success: false, error: 'Внутренняя ошибка' }
  }
}
