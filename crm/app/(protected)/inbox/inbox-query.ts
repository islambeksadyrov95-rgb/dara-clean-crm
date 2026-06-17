import { WAZZUP_CHANNELS } from '@/lib/wazzup/config'
import { getWazzupGlobalChatUrl } from '@/lib/wazzup/actions'

// Общая логика запроса URL глобального Wazzup-iframe для канала — используется и сервером
// (SSR-prefetch в page.tsx), и клиентом (useQuery в inbox-client.tsx). Один queryKey →
// дегидрация на клиенте совпадает с серверным префетчем, iframe виден на первой отрисовке
// без клиентского раунд-трипа.
//
// Как /clients (а НЕ /queue): URL отдаёт Server Action getWazzupGlobalChatUrl — ему нужен
// серверный fetch в Wazzup API (sync пользователя + v3/iframe). Поэтому и сервер, и клиент
// зовут ОДИН экшен — расходится только транспорт, а queryKey и форма результата едины.
// TanStack-кэш по каналу заменяет ручной Map-кэш: переключение вкладок туда-обратно отдаёт
// URL из кэша, «Обновить» делает refetch в обход staleTime.

// Канал первого рендера = первая вкладка (клиент стартует с WAZZUP_CHANNELS[0]).
// Сервер обязан строить queryKey ровно из этого id, иначе дегидрация не совпадёт с useQuery.
export function inboxDefaultChannelId(): string {
  return WAZZUP_CHANNELS[0].id
}

// Стабильный queryKey — ОДИН для серверного префетча и клиентского useQuery.
export function inboxChatUrlKey(channelId: string) {
  return ['inbox-chat-url', channelId] as const
}

// Тонкая обёртка над Server Action getWazzupGlobalChatUrl: бросает на ошибке, чтобы useQuery
// ушёл в isError, а серверный prefetch не закэшировал мусор.
export async function fetchInboxChatUrl(channelId: string): Promise<string> {
  const res = await getWazzupGlobalChatUrl(channelId)
  if (!res.success) throw new Error(res.error || 'Не удалось загрузить чаты')
  return res.url
}
