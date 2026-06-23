import 'server-only'
import { getPrimaryWazzupKey, getSecondaryWazzupKey } from './keys'

/**
 * Сотрудник Wazzup. id = СТАБИЛЬНЫЙ profiles.id (без суффикса канала).
 * Один сотрудник CRM = одна запись на аккаунт Wazzup. Раньше синк добавлял ещё
 * `${id}_${channelId}` — это плодило по 2-3 «сотрудника» на человека в списке прав
 * доступа к чатам. Стабильный id убирает дубли и делает синк идемпотентным.
 */
export interface WazzupUser {
  id: string
  name: string
}

const USERS_ENDPOINT = 'https://api.wazzup24.com/v3/users'
const SYNC_TIMEOUT_MS = 15_000

/** Upsert сотрудников в ОДИН аккаунт Wazzup. Best-effort: сбой логируем, не бросаем. */
export async function syncWazzupUsersForKey(apiKey: string, users: WazzupUser[]): Promise<void> {
  if (!apiKey || users.length === 0) return
  try {
    const res = await fetch(USERS_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(users),
    })
    if (!res.ok) console.error('[wazzup/syncWazzupUsers]', res.status, await res.text())
  } catch (err) {
    console.error('[wazzup/syncWazzupUsers] exception', err)
  }
}

/** Upsert сотрудников в ОБА аккаунта Wazzup. Один упавший аккаунт не мешает второму. */
export async function syncWazzupUsersBothAccounts(users: WazzupUser[]): Promise<void> {
  if (users.length === 0) return
  await Promise.allSettled([
    syncWazzupUsersForKey(getPrimaryWazzupKey(), users),
    syncWazzupUsersForKey(getSecondaryWazzupKey(), users),
  ])
}
