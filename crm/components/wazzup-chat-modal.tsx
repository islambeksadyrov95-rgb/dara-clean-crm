'use client'

import { useEffect, useState } from 'react'
import { getWazzupChatUrl } from '@/lib/wazzup/actions'
import { AlertTriangle } from 'lucide-react'
import { OrderForm } from '@/app/(protected)/queue/order-form'

type Props = {
  isOpen: boolean
  onClose: () => void
  clientPhone: string
  clientName: string
  clientId?: string
  totalOrders?: number
}

export function WazzupChatModal({ isOpen, onClose, clientPhone, clientName, clientId, totalOrders }: Props) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showOrderForm, setShowOrderForm] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    async function loadChatUrl() {
      setLoading(true)
      setError('')
      setUrl('')
      
      const res = await getWazzupChatUrl(clientPhone)
      if (res.success) {
        setUrl(res.url)
      } else {
        setError(res.error || 'Не удалось загрузить чат')
      }
      setLoading(false)
    }

    loadChatUrl()
    // При закрытии/открытии сбрасываем состояние формы заказа
    setShowOrderForm(false)
  }, [isOpen, clientPhone])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl h-[85vh] flex flex-col bg-white border border-[#ebe9e4] rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Шапка модального окна */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#ebe9e4]/60 bg-[#fcfcfb]">
          <div>
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              Чат с клиентом: <span className="font-bold">{clientName}</span>
            </h3>
            <p className="text-xs text-muted-foreground">{clientPhone}</p>
          </div>
          
          <div className="flex items-center">
            {clientId && (
              <button
                onClick={() => setShowOrderForm(!showOrderForm)}
                className={`mr-4 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                  showOrderForm 
                    ? 'bg-primary text-primary-foreground border-primary' 
                    : 'bg-background text-foreground border-border hover:bg-muted'
                }`}
              >
                {showOrderForm ? 'Скрыть форму заказа' : 'Оформить заказ'}
              </button>
            )}
            
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-[#f3f2ee] transition-colors cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Контент */}
        <div className="flex-1 min-h-0 bg-[#fcfcfb] relative flex">
          {/* Левая колонка - Чат Wazzup */}
          <div className="flex-1 min-h-0 relative">
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
                <p className="text-sm font-semibold text-foreground mb-1">Не удалось открыть диалог</p>
                <p className="text-xs text-red-600 max-w-md mb-4">{error}</p>
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-md shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
                >
                  Закрыть окно
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

          {/* Правая колонка - Форма заказа */}
          {showOrderForm && clientId && (
            <div className="w-96 border-l border-[#ebe9e4] bg-white p-4 overflow-y-auto max-h-full animate-in slide-in-from-right duration-200">
              <OrderForm
                clientId={clientId}
                clientName={clientName}
                totalOrders={totalOrders ?? 0}
                onDone={() => {
                  setShowOrderForm(false)
                }}
                onCancel={() => setShowOrderForm(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
