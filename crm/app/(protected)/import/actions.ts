'use server'

import { createAdminClient } from '@/lib/supabase/admin'

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
}

const BATCH_SIZE = 500

export async function importClients(
  clients: ClientRow[]
): Promise<ImportResult> {
  const supabase = createAdminClient()

  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  // 1. Получаем список всех менеджеров в системе
  let managers: { id: string }[] = []
  try {
    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers()
    if (!usersError && usersData?.users) {
      managers = usersData.users.filter((u) => u.user_metadata?.role !== 'admin')
    }
  } catch (err) {
    console.error('Ошибка получения списка менеджеров для импорта:', err)
  }

  let managerIndex = 0

  // 2. Пакетный upsert
  for (let i = 0; i < clients.length; i += BATCH_SIZE) {
    const batch = clients.slice(i, i + BATCH_SIZE)
    const batchPhones = batch.map((c) => c.phone)

    // Запрашиваем существующих клиентов в этом батче, чтобы сохранить их ответственных менеджеров
    const existingMap = new Map<string, string | null>()
    try {
      const { data: existingClients } = await supabase
        .from('clients')
        .select('phone, assigned_manager_id')
        .in('phone', batchPhones)

      existingClients?.forEach((ec) => {
        existingMap.set(ec.phone, ec.assigned_manager_id)
      });
    } catch (err) {
      console.warn('Не удалось запросить существующих клиентов:', err)
    }

    const insertBatch = batch.map((c) => {
      // Ищем, есть ли уже ответственный менеджер у этого клиента в БД
      let assignedManagerId = existingMap.get(c.phone)

      // Если клиент новый (нет в БД) и у нас есть менеджеры — распределяем по Round-Robin
      if (assignedManagerId === undefined && managers.length > 0) {
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

    const { data, error } = await supabase
      .from('clients')
      .upsert(insertBatch, { onConflict: 'phone', ignoreDuplicates: false })
      .select('created_at, updated_at')

    if (error) {
      result.errors.push(`Пакет ${i / BATCH_SIZE + 1}: ${error.message}`)
      result.skipped += batch.length
      continue
    }

    if (data) {
      for (const row of data) {
        const created = new Date(row.created_at)
        const updated = new Date(row.updated_at)
        // Разница < 1 секунды — считаем новой записью
        if (Math.abs(updated.getTime() - created.getTime()) < 1000) {
          result.created++
        } else {
          result.updated++
        }
      }
    }
  }

  return result
}
