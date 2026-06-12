'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { classifyAcquisitionAnswer } from '@/lib/acquisition/classify'

// Источник клиента: менеджер записывает дословный ответ на «Откуда вы о нас узнали?»,
// ИИ сопоставляет его со строгим справочником acquisition_sources. Уверенное совпадение —
// источник проставляется; нет — клиент попадает в очередь разбора админа (/settings/sources).
// Первое касание — истина: уже заполненный источник не перезаписывается.

export type ClientAcquisition = {
  sourceId: string | null
  sourceName: string | null
  rawAnswer: string | null
}

const RAW_ANSWER_MAX = 300

export async function getClientAcquisition(clientId: string): Promise<ClientAcquisition | null> {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const admin = createAdminClient()
    const { data } = await admin
      .from('clients')
      .select('acquisition_source_id, acquisition_answer_raw, source:acquisition_sources(name)')
      .eq('id', clientId)
      .maybeSingle()
    if (!data) return null
    return {
      sourceId: data.acquisition_source_id ?? null,
      sourceName: data.source?.name ?? null,
      rawAnswer: data.acquisition_answer_raw ?? null,
    }
  } catch (err) {
    console.error('getClientAcquisition error:', err)
    return null
  }
}

/** Сохраняет ответ клиента + ИИ-классификация по справочнику. */
export async function saveAcquisitionAnswer(clientId: string, rawAnswer: string) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }

    const answer = rawAnswer.trim().slice(0, RAW_ANSWER_MAX)
    if (!answer) return { success: false as const, error: 'Пустой ответ' }

    const admin = createAdminClient()

    const { data: current } = await admin
      .from('clients')
      .select('acquisition_source_id')
      .eq('id', clientId)
      .maybeSingle()
    if (current?.acquisition_source_id) {
      return { success: true as const, matched: true, alreadySet: true }
    }

    const { data: sources } = await admin
      .from('acquisition_sources')
      .select('id, name, synonyms')
      .eq('is_active', true)
      .order('name')

    const { sourceId } = await classifyAcquisitionAnswer(answer, sources ?? [])

    const payload: { acquisition_answer_raw: string; acquisition_source_id?: string } = {
      acquisition_answer_raw: answer,
    }
    if (sourceId) payload.acquisition_source_id = sourceId

    const { error } = await admin.from('clients').update(payload).eq('id', clientId)
    if (error) {
      console.error('saveAcquisitionAnswer update error:', error.message)
      return { success: false as const, error: 'Не удалось сохранить ответ' }
    }
    return { success: true as const, matched: Boolean(sourceId), alreadySet: false }
  } catch (err) {
    console.error('saveAcquisitionAnswer error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}
