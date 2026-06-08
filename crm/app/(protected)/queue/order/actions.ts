'use server'

import { createClient } from '@/lib/supabase/server'

type CreateOrderInput = {
  clientId: string
  services: string[]
  amount: number
  comment?: string
}

function calculateDiscount(totalOrders: number, amount: number, servicesCount: number) {
  let percent = 0

  // 5% — повторный клиент
  if (totalOrders >= 1) percent = 5

  // 10% — сумма > 30 000
  if (amount > 30000) percent = 10

  // 15% — комплекс (2+ услуги)
  if (servicesCount >= 2) percent = 15

  return {
    discount_percent: percent,
    discount_amount: Math.round(amount * percent) / 100,
  }
}

export async function createOrder({ clientId, services, amount, comment }: CreateOrderInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false as const, error: 'Не авторизован' }
  }

  if (!services.length) {
    return { success: false as const, error: 'Выберите хотя бы одну услугу' }
  }

  if (amount <= 0) {
    return { success: false as const, error: 'Сумма должна быть больше 0' }
  }

  // Получить клиента для проверки повторности
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name, total_orders, total_spent')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return { success: false as const, error: 'Клиент не найден' }
  }

  const { discount_percent, discount_amount } = calculateDiscount(
    client.total_orders ?? 0,
    amount,
    services.length
  )

  // Создать заказ
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      client_id: clientId,
      manager_id: user.id,
      services,
      amount,
      discount_percent,
      discount_amount,
      comment: comment || null,
    })
    .select('id, created_at')
    .single()

  if (orderError) {
    return { success: false as const, error: `Ошибка создания заказа: ${orderError.message}` }
  }

  // Обновить агрегаты клиента
  const newTotalOrders = (client.total_orders ?? 0) + 1
  const newTotalSpent = (client.total_spent ?? 0) + amount
  const newAvg = Math.round((newTotalSpent / newTotalOrders) * 100) / 100

  // Получаем текущие данные клиента, чтобы проверить наличие ответственного
  const { data: clientData } = await supabase
    .from('clients')
    .select('assigned_manager_id')
    .eq('id', clientId)
    .single()

  const updateFields: any = {
    total_orders: newTotalOrders,
    total_spent: newTotalSpent,
    avg_order_value: newAvg,
    last_order_date: new Date().toISOString(),
  }

  // Если у клиента нет ответственного менеджера, закрепляем его за менеджером, создавшим заказ
  if (clientData && !clientData.assigned_manager_id) {
    updateFields.assigned_manager_id = user.id
  }

  await supabase
    .from('clients')
    .update(updateFields)
    .eq('id', clientId)

  return {
    success: true as const,
    order: {
      id: order.id,
      services,
      amount,
      discount_percent,
      discount_amount,
      final_amount: amount - discount_amount,
      client_name: client.name,
      created_at: order.created_at,
    },
  }
}
