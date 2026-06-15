import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

type WazzupLogInsert = Database['public']['Tables']['wazzup_api_log']['Insert']

/**
 * Записывает действие интеграции Wazzup в append-only лог (wazzup_api_log).
 * Best-effort: сбой логирования НЕ должен ломать саму отправку — ошибка пишется
 * в console, наружу не пробрасывается. Таблица deny-by-default → service role.
 */
export async function logWazzupCall(entry: WazzupLogInsert): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('wazzup_api_log').insert(entry)
    if (error) console.error('[wazzup-log]', error.message)
  } catch (err) {
    console.error('[wazzup-log]', err instanceof Error ? err.message : err)
  }
}
