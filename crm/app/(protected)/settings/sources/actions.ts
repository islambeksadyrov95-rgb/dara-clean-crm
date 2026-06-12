'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRole } from '@/lib/auth/get-user-role'

// Справочник источников + очередь разбора (админ). Очередь разбора = клиенты
// с записанным ответом (acquisition_answer_raw) без определённого источника —
// ИИ не был уверен. Новые источники создаёт ТОЛЬКО человек отсюда.

export type AcquisitionSource = {
  id: string
  name: string
  synonyms: string[]
  is_active: boolean
}

export type ReviewQueueItem = {
  id: string
  name: string
  phone: string
  rawAnswer: string
}

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Не авторизован' }
  if (getUserRole(user) !== 'admin') {
    return { ok: false, error: 'Доступ запрещен. Требуются права администратора.' }
  }
  return { ok: true }
}

export async function listSourcesAdmin(): Promise<AcquisitionSource[]> {
  try {
    const gate = await requireAdmin()
    if (!gate.ok) return []
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('acquisition_sources')
      .select('id, name, synonyms, is_active')
      .order('name')
    if (error || !data) return []
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      synonyms: row.synonyms ?? [],
      is_active: row.is_active ?? true,
    }))
  } catch (err) {
    console.error('listSourcesAdmin error:', err)
    return []
  }
}

export async function createSource(name: string, synonymsRaw: string) {
  try {
    const gate = await requireAdmin()
    if (!gate.ok) return { success: false as const, error: gate.error }

    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 60) {
      return { success: false as const, error: 'Название источника: 1–60 символов' }
    }
    const synonyms = synonymsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const admin = createAdminClient()
    const { error } = await admin.from('acquisition_sources').insert({ name: trimmed, synonyms })
    if (error) {
      if (error.code === '23505') return { success: false as const, error: 'Источник с таким названием уже есть' }
      console.error('createSource error:', error.message)
      return { success: false as const, error: 'Не удалось создать источник' }
    }
    return { success: true as const }
  } catch (err) {
    console.error('createSource error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

export async function toggleSource(id: string, isActive: boolean) {
  try {
    const gate = await requireAdmin()
    if (!gate.ok) return { success: false as const, error: gate.error }
    const admin = createAdminClient()
    const { error } = await admin.from('acquisition_sources').update({ is_active: isActive }).eq('id', id)
    if (error) {
      console.error('toggleSource error:', error.message)
      return { success: false as const, error: 'Не удалось изменить источник' }
    }
    return { success: true as const }
  } catch (err) {
    console.error('toggleSource error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

/** Клиенты с ответом, который ИИ не смог уверенно сопоставить, — на ручной разбор. */
export async function listReviewQueue(): Promise<ReviewQueueItem[]> {
  try {
    const gate = await requireAdmin()
    if (!gate.ok) return []
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('clients')
      .select('id, name, phone, acquisition_answer_raw')
      .not('acquisition_answer_raw', 'is', null)
      .is('acquisition_source_id', null)
      .order('updated_at', { ascending: false })
    if (error || !data) return []
    return data.map((row) => ({
      id: row.id,
      name: row.name ?? '',
      phone: row.phone ?? '',
      rawAnswer: row.acquisition_answer_raw ?? '',
    }))
  } catch (err) {
    console.error('listReviewQueue error:', err)
    return []
  }
}

export async function assignSource(clientId: string, sourceId: string) {
  try {
    const gate = await requireAdmin()
    if (!gate.ok) return { success: false as const, error: gate.error }
    const admin = createAdminClient()
    const { error } = await admin.from('clients').update({ acquisition_source_id: sourceId }).eq('id', clientId)
    if (error) {
      console.error('assignSource error:', error.message)
      return { success: false as const, error: 'Не удалось назначить источник' }
    }
    return { success: true as const }
  } catch (err) {
    console.error('assignSource error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

/** Игнорировать ответ: админ решил, что это шум — убираем из очереди разбора. */
export async function ignoreAnswer(clientId: string) {
  try {
    const gate = await requireAdmin()
    if (!gate.ok) return { success: false as const, error: gate.error }
    const admin = createAdminClient()
    const { error } = await admin.from('clients').update({ acquisition_answer_raw: null }).eq('id', clientId)
    if (error) {
      console.error('ignoreAnswer error:', error.message)
      return { success: false as const, error: 'Не удалось обновить клиента' }
    }
    return { success: true as const }
  } catch (err) {
    console.error('ignoreAnswer error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}
