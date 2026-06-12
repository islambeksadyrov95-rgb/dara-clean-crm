import { createAdminClient } from '@/lib/supabase/admin'
import { classifyAcquisitionAnswer } from '@/lib/acquisition/classify'

// Автозапись источника из транскрипта звонка (VPBX и локальные записи MicroSIP).
// Принципы: первое касание — истина (не перезаписываем источник и ожидающий разбора
// ответ); любые ошибки глотаются — пайплайн транскрибации сломаться не должен.

const RAW_ANSWER_MAX = 300

type Admin = ReturnType<typeof createAdminClient>

export async function storeAcquisitionFromCall(admin: Admin, clientId: string, rawAnswer: string): Promise<void> {
  try {
    const answer = rawAnswer.trim().slice(0, RAW_ANSWER_MAX)
    if (!answer) return

    const { data: current } = await admin
      .from('clients')
      .select('acquisition_source_id, acquisition_answer_raw')
      .eq('id', clientId)
      .maybeSingle()
    if (!current || current.acquisition_source_id || current.acquisition_answer_raw) return

    const { data: sources } = await admin
      .from('acquisition_sources')
      .select('id, name, synonyms')
      .eq('is_active', true)

    const { sourceId } = await classifyAcquisitionAnswer(answer, sources ?? [])

    const payload: { acquisition_answer_raw: string; acquisition_source_id?: string } = {
      acquisition_answer_raw: answer,
    }
    if (sourceId) payload.acquisition_source_id = sourceId

    await admin.from('clients').update(payload).eq('id', clientId)
  } catch (err) {
    console.error('[acquisition] store from call failed:', err instanceof Error ? err.message : err)
  }
}
