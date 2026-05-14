'use server'

import { createClient } from '@/lib/supabase/server'

const LOCK_DURATION_MINUTES = 10

export async function lockClient(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Не авторизован' }
  }

  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString()

  // Атомарный лок: обновляем только если клиент свободен или лок истёк
  const { data } = await supabase
    .from('clients')
    .update({ locked_by: user.id, locked_until: lockedUntil })
    .eq('id', clientId)
    .or(`locked_by.is.null,locked_until.lt.${new Date().toISOString()}`)
    .select('id')
    .single()

  if (!data) {
    return { success: false, error: 'Клиент уже занят другим менеджером' }
  }

  return { success: true }
}

export async function unlockClient(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Не авторизован' }
  }

  // Разблокировать можно только своего клиента
  const { data } = await supabase
    .from('clients')
    .update({ locked_by: null, locked_until: null })
    .eq('id', clientId)
    .eq('locked_by', user.id)
    .select('id')
    .single()

  if (!data) {
    return { success: false, error: 'Клиент не заблокирован вами' }
  }

  return { success: true }
}
