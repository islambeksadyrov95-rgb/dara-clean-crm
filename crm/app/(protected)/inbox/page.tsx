'use client'

import { useEffect, useState } from 'react'
import { getWazzupGlobalChatUrl } from '@/lib/wazzup/actions'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function InboxPage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadChatUrl = async () => {
    setLoading(true)
    setError('')
    setUrl('')
    
    const res = await getWazzupGlobalChatUrl()
    if (res.success) {
      setUrl(res.url)
    } else {
      setError(res.error || 'Не удалось загрузить чаты')
    }
    setLoading(false)
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      loadChatUrl()
    })
  }, [])

  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)] space-y-4">
      {/* Шапка */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Диалоги WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Единое окно переписок со всеми клиентами через Wazzup
          </p>
        </div>
        {!error && !loading && (
          <button
            onClick={loadChatUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#ebe9e4] rounded-lg bg-white text-muted-foreground hover:text-foreground hover:bg-[#f7f6f3] transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Обновить
          </button>
        )}
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
              onClick={loadChatUrl}
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
