'use client'

import { useEffect, useState } from 'react'
import { generateWhatsAppMessage } from './whatsapp/actions'
import { sendWhatsAppMessage } from '@/app/(protected)/broadcasts/actions'
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
  const [sending, setSending] = useState(false)

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

  // Отправка через Wazzup (корпоративный номер + история в Wazzup + авто-лог
  // «кто отправил» в wazzup_api_log). Не wa.me с личного телефона менеджера.
  async function handleSend() {
    setError('')
    setSending(true)
    try {
      const res = await sendWhatsAppMessage(phone, message)
      if (!res.success) { setError(res.error); return }
      setSent(true)
    } catch {
      setError('Не удалось отправить сообщение — попробуйте ещё раз')
    } finally {
      setSending(false)
    }
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
          <div className="font-semibold text-green-800 mb-1">Сообщение отправлено</div>
          <div className="text-sm text-muted-foreground">{clientName} получит его в WhatsApp (через Wazzup)</div>
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
        <Button size="sm" variant="outline" onClick={handleCopy} disabled={sending}>
          {copied ? 'Скопировано!' : 'Скопировать'}
        </Button>
        <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={handleSend} disabled={sending || !message.trim()}>
          {sending ? 'Отправка…' : 'Отправить'}
        </Button>
      </div>

      <Button size="sm" variant="ghost" onClick={onCancel} className="w-full" disabled={sending}>
        Отмена
      </Button>
    </div>
  )
}
