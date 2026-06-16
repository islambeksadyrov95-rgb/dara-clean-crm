'use client'

import { useEffect, useState } from 'react'
import { generateWhatsAppMessage } from './whatsapp/actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  clientId: string
  onDone: () => void
  onCancel: () => void
}

export function WhatsAppPanel({ clientId, onDone, onCancel }: Props) {
  const [message, setMessage] = useState('')
  const [phone, setPhone] = useState('')
  const [clientName, setClientName] = useState('')
  const [isAI, setIsAI] = useState(false)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    generateWhatsAppMessage(clientId)
      .then((result) => {
        setMessage(result.message)
        setClientName(result.clientName)
        setPhone(result.phone)
        setIsAI(result.isAI)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false))
  }, [clientId])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Не удалось скопировать')
    }
  }

  function handleOpenWhatsApp() {
    const cleanPhone = phone.replace(/[^0-9]/g, '')
    const win = window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank')
    // Попап заблокирован браузером → не помечаем «отправлено», иначе менеджер уверен,
    // что написал, хотя вкладка не открылась.
    if (!win) {
      setError('Браузер заблокировал всплывающее окно. Разрешите popup для этого сайта и повторите.')
      return
    }
    setSent(true)
  }

  if (loading) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Генерация сообщения...</div>
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
        <Button size="sm" variant="ghost" onClick={onCancel}>Назад</Button>
      </div>
    )
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-lg bg-green-50 border border-green-200">
          <div className="font-semibold text-green-800 mb-1">WhatsApp открыт</div>
          <div className="text-sm text-muted-foreground">Сообщение для {clientName} готово к отправке</div>
        </div>
        <Button size="sm" onClick={onDone} className="w-full">
          Следующий клиент
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">
        WhatsApp — {clientName}
        <span className="ml-2 text-xs text-muted-foreground">{isAI ? 'AI' : 'шаблон'}</span>
      </div>

      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        className="text-sm"
      />

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={handleCopy}>
          {copied ? 'Скопировано!' : 'Скопировать'}
        </Button>
        <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={handleOpenWhatsApp}>
          Открыть WhatsApp
        </Button>
      </div>

      <Button size="sm" variant="ghost" onClick={onCancel} className="w-full">
        Отмена
      </Button>
    </div>
  )
}
