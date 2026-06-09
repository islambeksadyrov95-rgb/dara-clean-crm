'use client'

import { useEffect, useState, useCallback } from 'react'
import { getWazzupGlobalChatUrl } from '@/lib/wazzup/actions'
import { WAZZUP_CHANNELS } from '@/lib/wazzup/config'
import { AlertTriangle, RefreshCw } from 'lucide-react'

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className}
  >
    <path d="M12.004 2C6.48 2 2 6.48 2 12.004c0 1.83.497 3.59 1.442 5.158L2.01 22l4.997-1.312c1.51.822 3.21 1.258 4.997 1.258 5.524 0 10.004-4.48 10.004-10.004C22.008 6.48 17.528 2 12.004 2zM17.47 16.3c-.244.69-1.22 1.25-1.745 1.297-.482.043-.984.053-1.636-.145-2.585-.788-4.258-3.418-4.387-3.59-.13-.17-1.042-1.385-1.042-2.643 0-1.258.66-1.877.893-2.128.232-.25.503-.314.67-.314.168 0 .337.004.483.012.152.008.356-.057.558.428.204.49.7 1.706.762 1.832.062.126.103.272.018.442-.085.17-.127.275-.252.422-.124.148-.262.33-.375.443-.125.126-.256.264-.11.515.147.25.65.25.65.25.65 1.07 1.448 1.895 2.148 2.222.127.06.27.126.398.01.127-.116.55-.64.697-.857.147-.217.295-.183.496-.108.2.074 1.272.6 1.492.71.22.11.367.165.42.257.054.09.054.53-.19.1.22-.09.22.25.22.25z" />
  </svg>
)

export default function InboxPage() {
  const [activeTab, setActiveTab] = useState(WAZZUP_CHANNELS[0].id)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadChatUrl = useCallback(async (channelId: string) => {
    setLoading(true)
    setError('')
    setUrl('')
    
    const res = await getWazzupGlobalChatUrl(channelId)
    if (res.success) {
      setUrl(res.url)
    } else {
      setError(res.error || 'Не удалось загрузить чаты')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => {
      loadChatUrl(activeTab)
    })
  }, [activeTab, loadChatUrl])

  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)] space-y-4">
      {/* Шапка */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Диалоги WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Единое окно переписок со всеми клиентами через Wazzup
          </p>
        </div>

        {/* Вкладки переключения каналов */}
        <div className="flex items-center gap-1.5 bg-[#f5f4f0] p-1 rounded-lg border border-[#ebe9e4]">
          {WAZZUP_CHANNELS.map((ch) => {
            const isActive = activeTab === ch.id
            return (
              <button
                key={ch.id}
                onClick={() => {
                  if (isActive || loading) return
                  setActiveTab(ch.id)
                }}
                disabled={loading}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  isActive
                    ? 'bg-white text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/50'
                } disabled:opacity-50`}
              >
                <WhatsAppIcon className="h-3.5 w-3.5 text-[#25d366]" />
                {ch.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          {!error && !loading && (
            <button
              onClick={() => loadChatUrl(activeTab)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#ebe9e4] rounded-lg bg-white text-muted-foreground hover:text-foreground hover:bg-[#f7f6f3] transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Обновить
            </button>
          )}
        </div>
      </div>

      {/* Основной контейнер с чатом */}
      <div className="flex-1 min-h-0 bg-white border border-[#ebe9e4] rounded-xl shadow-xs relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10">
            <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin mb-2" />
            <p className="text-xs text-muted-foreground">Подключение к Wazzup...</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-white">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-500 mb-3">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">Не удалось загрузить чаты</p>
            <p className="text-xs text-red-600 max-w-md mb-4">{error}</p>
            <button
              onClick={() => loadChatUrl(activeTab)}
              className="px-4 py-1.5 text-xs font-semibold bg-[#1f2937] hover:bg-gray-800 text-white rounded-md shadow-xs transition-colors"
            >
              Попробовать снова
            </button>
          </div>
        )}

        {url && (
          <iframe
            src={url}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write; microphone; camera"
          />
        )}
      </div>
    </div>
  )
}
