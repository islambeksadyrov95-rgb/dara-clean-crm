'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getSettings, updateSetting, type Discounts, type Scripts, type SalesPlan } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const SEGMENT_LABELS: Record<string, string> = {
  new: 'Новый', repeat: 'Повторный', regular: 'Постоянный',
  at_risk: 'В риске', lost: 'Потерянный',
}

const SEGMENT_MAP: Record<string, string> = {
  new: 'Новый', repeat: 'Повторный', regular: 'Постоянный',
  at_risk: 'В риске', lost: 'Потерянный',
}

export default function SettingsPage() {
  const [discounts, setDiscounts] = useState<Discounts>({ new: 5, repeat: 5, regular: 10, at_risk: 10, lost: 15 })
  const [scripts, setScripts] = useState<Scripts>({})
  const [dayTarget, setDayTarget] = useState(40)
  const [salesPlan, setSalesPlan] = useState<SalesPlan>({ avg_check: 17000, calls_per_day: 40, target_conversion: 12, plan_orders_per_day: 5, plan_revenue_per_day: 85000 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSettings().then((s) => {
      setDiscounts(s.discounts)
      setScripts(s.scripts)
      setDayTarget(s.dayTarget)
      setSalesPlan(s.salesPlan)
      setLoading(false)
    })
  }, [])

  const handleSaveDiscounts = async () => {
    setSaving(true)
    const res = await updateSetting('discounts', discounts)
    if (res.success) toast.success('Скидки сохранены')
    else toast.error(res.error)
    setSaving(false)
  }

  const handleSaveScripts = async () => {
    setSaving(true)
    const res = await updateSetting('scripts', scripts)
    if (res.success) toast.success('Скрипты сохранены')
    else toast.error(res.error)
    setSaving(false)
  }

  const handleSaveTarget = async () => {
    setSaving(true)
    const res = await updateSetting('day_target', dayTarget)
    if (res.success) toast.success('План дня сохранён')
    else toast.error(res.error)
    setSaving(false)
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Загрузка...</div>

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Настройки CRM</h1>

      {/* Скидки */}
      <section className="mb-6 rounded-xl border bg-card shadow-sm p-5">
        <h2 className="text-lg font-semibold mb-3">Скидки по сегментам (%)</h2>
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(SEGMENT_LABELS) as Array<keyof Discounts>).map((key) => (
            <div key={key} className="flex items-center gap-3">
              <Label className="w-28 text-sm">{SEGMENT_LABELS[key]}</Label>
              <Input
                type="number" min={0} max={50}
                value={discounts[key]}
                onChange={(e) => setDiscounts({ ...discounts, [key]: Number(e.target.value) || 0 })}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          ))}
        </div>
        <Button size="sm" onClick={handleSaveDiscounts} disabled={saving} className="mt-3">
          Сохранить скидки
        </Button>
      </section>

      {/* План дня */}
      <section className="mb-6 rounded-xl border bg-card shadow-sm p-5">
        <h2 className="text-lg font-semibold mb-3">План звонков на день</h2>
        <div className="flex items-center gap-3">
          <Input
            type="number" min={1} max={200}
            value={dayTarget}
            onChange={(e) => setDayTarget(Number(e.target.value) || 1)}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">звонков</span>
          <Button size="sm" onClick={handleSaveTarget} disabled={saving}>Сохранить</Button>
        </div>
      </section>

      {/* План продаж */}
      <section className="mb-6 rounded-xl border bg-card shadow-sm p-5">
        <h2 className="text-lg font-semibold mb-3">План продаж</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm mb-1 block">Средний чек, ₸</Label>
            <Input type="number" min={0} value={salesPlan.avg_check}
              onChange={(e) => setSalesPlan({ ...salesPlan, avg_check: Number(e.target.value) || 0 })} />
          </div>
          <div>
            <Label className="text-sm mb-1 block">Цель конверсии, %</Label>
            <Input type="number" min={1} max={100} value={salesPlan.target_conversion}
              onChange={(e) => setSalesPlan({ ...salesPlan, target_conversion: Number(e.target.value) || 1 })} />
          </div>
          <div>
            <Label className="text-sm mb-1 block">Заказов в день</Label>
            <Input type="number" min={1} value={salesPlan.plan_orders_per_day}
              onChange={(e) => setSalesPlan({ ...salesPlan, plan_orders_per_day: Number(e.target.value) || 1 })} />
          </div>
          <div>
            <Label className="text-sm mb-1 block">Выручка в день, ₸</Label>
            <Input type="number" min={0} value={salesPlan.plan_revenue_per_day}
              onChange={(e) => setSalesPlan({ ...salesPlan, plan_revenue_per_day: Number(e.target.value) || 0 })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          При {salesPlan.calls_per_day} звонках и {salesPlan.target_conversion}% конверсии = {Math.round(salesPlan.calls_per_day * salesPlan.target_conversion / 100)} заказов &times; {salesPlan.avg_check.toLocaleString('ru-RU')} ₸ = {(Math.round(salesPlan.calls_per_day * salesPlan.target_conversion / 100) * salesPlan.avg_check).toLocaleString('ru-RU')} ₸/день
        </p>
        <Button size="sm" onClick={async () => {
          setSaving(true)
          const res = await updateSetting('sales_plan', salesPlan)
          if (res.success) toast.success('План продаж сохранён')
          else toast.error(res.error)
          setSaving(false)
        }} disabled={saving} className="mt-3">
          Сохранить план
        </Button>
      </section>

      {/* Скрипты */}
      <section className="mb-6 rounded-xl border bg-card shadow-sm p-5">
        <h2 className="text-lg font-semibold mb-1">Скрипты звонков</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Переменные: {'{имя}'} — имя клиента, {'{дней}'} — дней без заказа, {'{скидка}'} — скидка для сегмента
        </p>
        <div className="space-y-4">
          {Object.entries(SEGMENT_MAP).map(([key, segName]) => (
            <div key={key}>
              <Label className="mb-1 block text-sm font-medium">{segName}</Label>
              <Textarea
                value={scripts[segName] ?? ''}
                onChange={(e) => setScripts({ ...scripts, [segName]: e.target.value })}
                rows={3} className="text-sm"
              />
            </div>
          ))}
        </div>
        <Button size="sm" onClick={handleSaveScripts} disabled={saving} className="mt-3">
          Сохранить скрипты
        </Button>
      </section>
    </div>
  )
}
