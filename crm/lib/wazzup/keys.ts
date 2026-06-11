import 'server-only'
import { WAZZUP_CHANNELS } from './config'

/**
 * Wazzup API ключи по аккаунтам — секреты, читаются ТОЛЬКО на сервере из env.
 * Аккаунт 1 → WAZZUP_API_KEY (основной), аккаунт 2 → WAZZUP_API_KEY_2.
 * Канал WAZZUP_CHANNELS[1] принадлежит аккаунту 2; все остальные — аккаунту 1.
 */
const PRIMARY_KEY = process.env.WAZZUP_API_KEY ?? ''
const SECONDARY_KEY = process.env.WAZZUP_API_KEY_2 ?? ''

/** Ключ основного аккаунта Wazzup. */
export function getPrimaryWazzupKey(): string {
  return PRIMARY_KEY
}

/** Ключ второго аккаунта Wazzup. */
export function getSecondaryWazzupKey(): string {
  return SECONDARY_KEY
}

/** Подбирает ключ Wazzup под конкретный канал. */
export function getWazzupKeyForChannel(channelId?: string): string {
  if (channelId && channelId === WAZZUP_CHANNELS[1]?.id) {
    return SECONDARY_KEY
  }
  return PRIMARY_KEY
}
