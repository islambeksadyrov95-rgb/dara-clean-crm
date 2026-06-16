'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

// Клиентский кэш данных (TanStack Query) для всей области (protected).
//
// Зачем (как в лучших SaaS CRM): повторный заход на страницу отдаёт данные
// мгновенно из кэша + тихо ревалидирует в фоне; одинаковые запросы дедуплицируются;
// пагинация/поиск без скачка в «Загрузка» (placeholderData). Заменяет анти-паттерн
// useEffect+fetch+useState (см. CLAUDE.md).
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30с свежести: возврат на страницу — из кэша мгновенно, фоном обновление.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            // У нас свой visibility/realtime-рефреш — не дёргаем на каждый фокус окна.
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
