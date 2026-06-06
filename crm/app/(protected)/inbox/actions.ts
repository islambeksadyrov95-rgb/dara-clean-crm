'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type InboxEntry = {
  id: string
  clientId: string
  clientName: string
  clientPhone: string
  managerEmail: string
  createdAt: string
  templateText: string
  whatsappUrl: string
}

const discountMap: Record<string, number> = { 
  'Новый': 5, 
  'Повторный': 5, 
  'Постоянный': 10, 
  'В риске': 10, 
  'Потерянный': 15 
}

function getRFMSegment(client: {
  last_order_date: string | null
  total_orders: number
}) {
  if (!client.last_order_date) return 'Новый'
  const lastOrder = new Date(client.last_order_date)
  const diffTime = Math.abs(new Date().getTime() - lastOrder.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays > 180) return 'Потерянный'
  if (diffDays > 90) return 'В риске'
  if (client.total_orders >= 4) return 'Постоянный'
  if (client.total_orders >= 2) return 'Повторный'
  return 'Новый'
}

function getWhatsAppTemplate(name: string, segment: string) {
  const discount = discountMap[segment] ?? 5
  return `${name}, привет! Это Dara Clean. Скидка ${discount}% на чистку — действует 7 дней. Записать на удобный день?`
}

export async function getInboxWhatsAppLogs(): Promise<InboxEntry[]> {
  const supabase = await createClient()

  // Email менеджеров
  const adminSupabase = createAdminClient()
  const { data: usersData } = await adminSupabase.auth.admin.listUsers()
  const emailMap = new Map<string, string>()
  usersData?.users?.forEach((u) => emailMap.set(u.id, u.email ?? u.id.slice(0, 8)))

  const { data: callLogs, error } = await supabase
    .from('call_logs')
    .select(`
      id,
      created_at,
      manager_id,
      status,
      sub_status,
      clients!inner (
        id,
        name,
        phone,
        total_orders,
        total_spent,
        last_order_date
      )
    `)
    .eq('status', 'not_reached')
    .eq('sub_status', 'sent_whatsapp')
    .order('created_at', { ascending: false })

  if (error || !callLogs) {
    console.error('Error fetching inbox call logs:', error)
    return []
  }

  return callLogs.map((row: any) => {
    const client = row.clients
    const clientName = client?.name || 'Без имени'
    const clientPhone = client?.phone || ''
    const segment = getRFMSegment({
      last_order_date: client?.last_order_date,
      total_orders: client?.total_orders || 0
    })

    const templateText = getWhatsAppTemplate(clientName, segment)
    const cleanPhone = clientPhone.replace(/[^0-9]/g, '')
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(templateText)}`

    return {
      id: row.id,
      clientId: client?.id || '',
      clientName,
      clientPhone,
      managerEmail: emailMap.get(row.manager_id) || row.manager_id.slice(0, 8),
      createdAt: row.created_at,
      templateText,
      whatsappUrl,
    }
  })
}
