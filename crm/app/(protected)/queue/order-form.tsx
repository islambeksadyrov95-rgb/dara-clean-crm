'use client'

import { useEffect, useRef, useState } from 'react'
import { createOrder } from '@/app/(protected)/queue/order/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

const SERVICES = [
  { id: 'carpets', label: 'Ковры', key: '1' },
  { id: 'curtains', label: 'Шторы', key: '2' },
  { id: 'furniture', label: 'Мебель', key: '3' },
  { id: 'cleaning', label: 'Клининг', key: '4' },
] as const

type Props = {
  clientId: string
  clientName: string
  totalOrders: number
  onDone: () => void
  onCancel: () => void
}

// Курсор в редактируемом поле — горячие клавиши игнорируются (ввод суммы/текста).
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function calcDiscount(totalOrders: number, amount: number, servicesCount: number) {
  let percent = 0
  if (totalOrders >= 1) percent = 5
  if (amount > 30000) percent = 10
  if (servicesCount >= 2) percent = 15
  return percent
}

export function OrderForm({ clientId, clientName, totalOrders, onDone, onCancel }: Props) {
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ final_amount: number; discount_percent: number; discount_amount: number } | null>(null)

  const amountNum = parseFloat(amount) || 0
  const discountPercent = calcDiscount(totalOrders, amountNum, selectedServices.length)
  const discountAmount = Math.round((amountNum * discountPercent) / 100)
  const finalAmount = amountNum - discountAmount

  const toggleService = (label: string) => {
    setSelectedServices((prev) =>
      prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label]
    )
  }

  const handleSubmit = async () => {
    setError(null)
    if (!selectedServices.length) { setError('Выберите услугу'); return }
    if (amountNum <= 0) { setError('Введите сумму'); return }

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

    setResult({
      final_amount: res.order.final_amount,
      discount_percent: res.order.discount_percent,
      discount_amount: res.order.discount_amount,
    })
    setSubmitting(false)
  }

  // Горячие клавиши формы: 1-4 — услуги, Enter — submit (если форма валидна и фокус
  // не в textarea/поле). Через ref на актуальный обработчик, чтобы listener не
  // переподписывался на каждый ввод суммы. Не активны после результата (result != null).
  const submitRef = useRef(handleSubmit)
  submitRef.current = handleSubmit
  const canSubmit = !submitting && selectedServices.length > 0 && amountNum > 0

  useEffect(() => {
    if (result) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const service = SERVICES.find((s) => s.key === e.key)
      if (service) {
        e.preventDefault()
        setSelectedServices((prev) =>
          prev.includes(service.label) ? prev.filter((s) => s !== service.label) : [...prev, service.label]
        )
        return
      }
      if (e.key === 'Enter' && canSubmit) {
        e.preventDefault()
        void submitRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [result, canSubmit])

  if (result) {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-lg bg-green-50 border border-green-200">
          <div className="font-semibold text-green-800 mb-1">Заказ создан</div>
          <div className="text-sm">
            {selectedServices.join(', ')} &middot; {finalAmount.toLocaleString('ru-RU')} ₸
            {result.discount_percent > 0 && (
              <span className="text-muted-foreground"> (скидка {result.discount_percent}%)</span>
            )}
          </div>
        </div>
        <Button size="sm" onClick={onDone} className="w-full">
          Следующий клиент
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">Новый заказ — {clientName}</div>

      {/* Услуги */}
      <div>
        <Label className="mb-2 block text-xs text-muted-foreground">Услуги (1-4)</Label>
        <div className="grid grid-cols-2 gap-2">
          {SERVICES.map((s) => (
            <label key={s.id} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={selectedServices.includes(s.label)}
                onCheckedChange={() => toggleService(s.label)}
              />
              <span>{s.label}</span>
              <kbd className="ml-auto text-[10px] text-muted-foreground border rounded px-1">{s.key}</kbd>
            </label>
          ))}
        </div>
      </div>

      {/* Сумма */}
      <div>
        <Label htmlFor="order-amount" className="mb-1 block text-xs text-muted-foreground">Сумма, ₸</Label>
        <Input
          id="order-amount"
          type="number"
          min={0}
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
      </div>

      {/* Скидка */}
      {amountNum > 0 && (
        <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
          <div className="flex justify-between">
            <span>Повторный (5%)</span>
            {totalOrders >= 1
              ? <Badge className="bg-green-100 text-green-800 text-[10px]">да</Badge>
              : <Badge variant="outline" className="text-[10px]">нет</Badge>}
          </div>
          <div className="flex justify-between">
            <span>&gt; 30К (10%)</span>
            {amountNum > 30000
              ? <Badge className="bg-green-100 text-green-800 text-[10px]">да</Badge>
              : <Badge variant="outline" className="text-[10px]">нет</Badge>}
          </div>
          <div className="flex justify-between">
            <span>Комплекс 2+ (15%)</span>
            {selectedServices.length >= 2
              ? <Badge className="bg-green-100 text-green-800 text-[10px]">да</Badge>
              : <Badge variant="outline" className="text-[10px]">нет</Badge>}
          </div>
          <div className="border-t pt-2 mt-2 flex justify-between font-semibold">
            <span>Итого: {finalAmount.toLocaleString('ru-RU')} ₸</span>
            {discountPercent > 0 && <span className="text-green-700">−{discountPercent}%</span>}
          </div>
        </div>
      )}

      {/* Комментарий */}
      <div>
        <Label htmlFor="order-comment" className="mb-1 block text-xs text-muted-foreground">Комментарий</Label>
        <Textarea
          id="order-comment"
          placeholder="Примечание..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
        />
      </div>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          onClick={handleSubmit}
          disabled={submitting || !selectedServices.length || amountNum <= 0}
        >
          {submitting ? 'Создание...' : 'Создать заказ'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  )
}
