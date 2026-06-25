import 'server-only'
import { isValidPhone, toDialDigits } from '@/lib/phone'
import { logWazzupCall } from '@/lib/wazzup/log'

/**
 * Единая точка отправки WhatsApp через Wazzup для рассылок и кнопки в очереди.
 *
 * Почему не берём канал из хардкод-конфига: каналы аккаунтов «дрейфуют» —
 * номер может оказаться blocked/qridle на стороне Wazzup. Поэтому канал выбираем
 * ЖИВЫМ запросом: первый active WhatsApp-канал среди всех аккаунтов, и шлём его
 * ключом (active-канал может принадлежать второму аккаунту → нужен его ключ).
 */

const CHANNELS_URL = 'https://api.wazzup24.com/v3/channels'
const MESSAGE_URL = 'https://api.wazzup24.com/v3/message'
const CHANNELS_TIMEOUT_MS = 15_000
const MESSAGE_TIMEOUT_MS = 20_000

type WazzupChannel = { channelId: string; transport: string; state: string }
type ActiveChannel = { channelId: string; key: string }

export type WazzupSendResult = { success: true } | { success: false; error: string }

/** Ключи аккаунтов Wazzup. Читаем из env В МОМЕНТ вызова (не на импорте модуля) —
 *  иначе тесты и серверлесс-инстансы видят устаревшее окружение. */
function wazzupKeys(): string[] {
  const raw = [process.env.WAZZUP_API_KEY, process.env.WAZZUP_API_KEY_2]
  return [...new Set(raw.map((k) => (k ?? '').trim()).filter(Boolean))]
}

async function fetchChannels(key: string): Promise<WazzupChannel[]> {
  const res = await fetch(CHANNELS_URL, {
    signal: AbortSignal.timeout(CHANNELS_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? (data as WazzupChannel[]) : []
}

/** Первый active WhatsApp-канал среди всех аккаунтов + ключ его аккаунта.
 *  blocked/qridle пропускаем — отправка через них даёт 404. */
async function resolveActiveWhatsappChannel(): Promise<ActiveChannel | null> {
  for (const key of wazzupKeys()) {
    const channels = await fetchChannels(key)
    const active = channels.find((c) => c.transport === 'whatsapp' && c.state === 'active')
    if (active) return { channelId: active.channelId, key }
  }
  return null
}

async function extractMessageId(res: Response): Promise<string | null> {
  try {
    const data = await res.json()
    return typeof data?.messageId === 'string' ? data.messageId : null
  } catch {
    return null
  }
}

function logSend(p: {
  managerId: string
  channelId: string
  chatId: string
  textLength: number
  status: number
  latencyMs: number
  messageId?: string | null
}): Promise<void> {
  return logWazzupCall({
    command: 'message.send',
    op: 'send',
    direction: 'outbound',
    crm_entity: 'client',
    manager_id: p.managerId,
    channel_id: p.channelId,
    chat_id: p.chatId,
    message_id: p.messageId ?? null,
    http_status: p.status,
    error_code: p.status >= 400 ? String(p.status) : null,
    latency_ms: p.latencyMs,
    request: { chatType: 'whatsapp', textLength: p.textLength },
  })
}

async function deliver(
  channel: ActiveChannel,
  chatId: string,
  text: string,
  managerId: string,
): Promise<WazzupSendResult> {
  const startedAt = Date.now()
  let res: Response
  try {
    res = await fetch(MESSAGE_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(MESSAGE_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${channel.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: channel.channelId, chatId, chatType: 'whatsapp', text }),
    })
  } catch (err) {
    console.error('[wazzup-send] network error:', err)
    return { success: false, error: 'Сбой сети при отправке WhatsApp.' }
  }
  const latencyMs = Date.now() - startedAt
  const messageId = res.ok ? await extractMessageId(res) : null
  if (!res.ok) console.error('[wazzup-send] send failed, status:', res.status)
  await logSend({ managerId, channelId: channel.channelId, chatId, textLength: text.length, status: res.status, latencyMs, messageId })
  return res.ok ? { success: true } : { success: false, error: `Ошибка отправки WhatsApp (${res.status}).` }
}

/** Отправляет WhatsApp-сообщение клиенту через активный канал Wazzup. */
export async function sendWhatsAppViaWazzup(params: {
  phone: string
  text: string
  managerId: string
}): Promise<WazzupSendResult> {
  if (wazzupKeys().length === 0) {
    return { success: false, error: 'Интеграция с Wazzup не настроена на сервере (отсутствует API-ключ).' }
  }
  if (!isValidPhone(params.phone)) {
    return { success: false, error: 'Некорректный номер телефона клиента.' }
  }

  let channel: ActiveChannel | null
  try {
    channel = await resolveActiveWhatsappChannel()
  } catch (err) {
    console.error('[wazzup-send] channels fetch failed:', err)
    return { success: false, error: 'Не удалось получить список каналов Wazzup.' }
  }
  if (!channel) {
    return { success: false, error: 'Нет активного WhatsApp-канала Wazzup. Переподключите номер в кабинете Wazzup.' }
  }

  return deliver(channel, toDialDigits(params.phone), params.text, params.managerId)
}
