'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createOrder } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

const SERVICES = [
  { id: 'carpets', label: 'Ковры' },
  { id: 'curtains', label: 'Шторы' },
  { id: 'furniture', label: 'Мебель' },
  { id: 'cleaning', label: 'Клининг' },
] as const

type ClientInfo = {
  id: string
  name: string
  phone: string
  total_orders: number
  total_spent: number
}

type OrderResult = {
  id: string
  services: string[]
  amount: number
  discount_percent: number
  discount_amount: number
  final_amount: number
  client_name: string
  created_at: string
}

function calcDiscount(totalOrders: number, amount: number, servicesCount: number) {
  let percent = 0
  if (totalOrders >= 1) percent = 5
  if (amount > 30000) percent = 10
  if (servicesCount >= 2) percent = 15
  return percent
}

export default function OrderPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const router = useRouter()
  const [clientId, setClientId] = useState<string>('')
  const [client, setClient] = useState<ClientInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OrderResult | null>(null)

  // Resolve params
  useEffect(() => {
    params.then(({ clientId: id }) => setClientId(id))
  }, [params])

  // Fetch client info
  useEffect(() => {
    if (!clientId) return
    const supabase = createClient()
    supabase
      .from('clients')
      .select('id, name, phone, total_orders, total_spent')
      .eq('id', clientId)
      .single()
      .then(({ data }) => {
        setClient(data as ClientInfo | null)
        setLoading(false)
      })
  }, [clientId])

  const amountNum = parseFloat(amount) || 0
  const discountPercent = client ? calcDiscount(client.total_orders ?? 0, amountNum, selectedServices.length) : 0
  const discountAmount = Math.round(amountNum * discountPercent) / 100
  const finalAmount = amountNum - discountAmount

  const toggleService = (serviceLabel: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceLabel)
        ? prev.filter((s) => s !== serviceLabel)
        : [...prev, serviceLabel]
    )
  }

  const handleSubmit = async () => {
    setError(null)
    if (!selectedServices.length) {
      setError('Выберите хотя бы одну услугу')
      return
    }
    if (amountNum <= 0) {
      setError('Введите сумму')
      return
    }

    setSubmitting(true)
    const res = await createOrder({
      clientId,
      services: selectedServices,
      amount: amountNum,
      comment: comment.trim() || undefined,
    })

    if (!res.success) {
      setError(res.error)
      setSubmitting(false)
      return
    }

    setResult(res.order)
    setSubmitting(false)
  }

  if (loading) {
    return <div className="text-muted-foreground py-8 text-center">Загрузка...</div>
  }

  if (!client) {
    return (
      <div className="py-8 text-center">
        <p className="text-red-600 mb-4">Клиент не найден</p>
        <Button variant="outline" onClick={() => router.push('/queue')}>
          Вернуться в очередь
        </Button>
      </div>
    )
  }

  // Успешный результат
  if (result) {
    return (
      <div className="max-w-md mx-auto py-8">
        <div className="border rounded-lg p-6 bg-green-50">
          <h2 className="text-xl font-bold text-green-800 mb-4">Заказ создан</h2>
          <div className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Клиент:</span> {result.client_name}</div>
            <div><span className="text-muted-foreground">Услуги:</span> {result.services.join(', ')}</div>
            <div><span className="text-muted-foreground">Сумма:</span> {result.amount.toLocaleString('ru-RU')} ₸</div>
            {result.discount_percent > 0 && (
              <>
                <div><span className="text-muted-foreground">Скидка:</span> {result.discount_percent}% ({result.discount_amount.toLocaleString('ru-RU')} ₸)</div>
                <div className="font-semibold">Итого: {result.final_amount.toLocaleString('ru-RU')} ₸</div>
              </>
            )}
          </div>
        </div>
        <Button className="w-full mt-4" onClick={() => router.push('/queue')}>
          Вернуться в очередь
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-1">Создание заказа</h1>
      <p className="text-muted-foreground mb-6">{client.name} &middot; {client.phone}</p>

      {/* Услуги */}
      <div className="mb-6">
        <Label className="mb-3 block">Услуги</Label>
        <div className="space-y-3">
          {SERVICES.map((s) => (
            <label key={s.id} className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedServices.includes(s.label)}
                onCheckedChange={() => toggleService(s.label)}
              />
              <span className="text-sm">{s.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Сумма */}
      <div className="mb-6">
        <Label htmlFor="amount" className="mb-2 block">Сумма, ₸</Label>
        <Input
          id="amount"
          type="number"
          min={0}
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {/* Скидка */}
      {amountNum > 0 && (
        <div className="mb-6 p-4 border rounded-lg bg-muted/50">
          <div className="text-sm text-muted-foreground mb-2">Расчёт скидки</div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Повторный клиент (5%)</span>
              {(client.total_orders ?? 0) >= 1
                ? <Badge className="bg-green-100 text-green-800">да</Badge>
                : <Badge variant="outline">нет</Badge>}
            </div>
            <div className="flex justify-between">
              <span>Сумма {'>'} 30 000 ₸ (10%)</span>
              {amountNum > 30000
                ? <Badge className="bg-green-100 text-green-800">да</Badge>
                : <Badge variant="outline">нет</Badge>}
            </div>
            <div className="flex justify-between">
              <span>Комплекс 2+ услуги (15%)</span>
              {selectedServices.length >= 2
                ? <Badge className="bg-green-100 text-green-800">да</Badge>
                : <Badge variant="outline">нет</Badge>}
            </div>
          </div>
          <div className="border-t mt-3 pt-3 flex justify-between font-medium">
            <span>Скидка: {discountPercent}%</span>
            <span>−{discountAmount.toLocaleString('ru-RU')} ₸</span>
          </div>
          <div className="flex justify-between font-bold text-lg mt-1">
            <span>Итого:</span>
            <span>{finalAmount.toLocaleString('ru-RU')} ₸</span>
          </div>
        </div>
      )}

      {/* Комментарий */}
      <div className="mb-6">
        <Label htmlFor="comment" className="mb-2 block">Комментарий (необязательно)</Label>
        <Textarea
          id="comment"
          placeholder="Примечание к заказу..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          className="flex-1"
          onClick={handleSubmit}
          disabled={submitting || !selectedServices.length || amountNum <= 0}
        >
          {submitting ? 'Создание...' : 'Создать заказ'}
        </Button>
        <Button variant="outline" onClick={() => router.push('/queue')}>
          Отмена
        </Button>
      </div>
    </div>
  )
}
