'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { generateWhatsAppMessage } from '../actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export default function WhatsAppPage() {
  const params = useParams<{ clientId: string }>()
  const router = useRouter()
  const clientId = params.clientId

  const [message, setMessage] = useState('')
  const [clientName, setClientName] = useState('')
  const [phone, setPhone] = useState('')
  const [isAI, setIsAI] = useState(false)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const result = await generateWhatsAppMessage(clientId)
        setMessage(result.message)
        setClientName(result.clientName)
        setPhone(result.phone)
        setIsAI(result.isAI)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      } finally {
        setLoading(false)
      }
    }
    load()
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
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
    window.open(url, '_blank')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Генерация сообщения...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto py-8">
        <p className="text-red-600 mb-4">{error}</p>
        <Button variant="outline" onClick={() => router.push('/queue')}>
          Вернуться в очередь
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp для {clientName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {isAI ? 'Сообщение сгенерировано AI' : 'Шаблонное сообщение'}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="wa-message">Текст сообщения</Label>
            <Textarea
              id="wa-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              className="mt-1"
            />
          </div>

          <div className="flex gap-3">
            <Button onClick={handleCopy} variant="outline">
              {copied ? 'Скопировано!' : 'Скопировать'}
            </Button>
            <Button onClick={handleOpenWhatsApp} className="bg-green-600 hover:bg-green-700">
              Открыть WhatsApp
            </Button>
          </div>
        </CardContent>
      </Card>

      <Button variant="ghost" onClick={() => router.push('/queue')}>
        &larr; Вернуться в очередь
      </Button>
    </div>
  )
}
