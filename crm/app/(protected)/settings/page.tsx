'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { getSettings, updateSetting, getManagersProfiles, type Discounts, type Scripts, type SalesPlan, type MotivationSettings, type ManagerProfile } from './actions'
import { getUserRole } from '@/lib/auth/get-user-role'
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
  const supabase = createClient()
  const [discounts, setDiscounts] = useState<Discounts>({ new: 5, repeat: 5, regular: 10, at_risk: 10, lost: 15 })
  const [scripts, setScripts] = useState<Scripts>({})
  const [dayTarget, setDayTarget] = useState(40)
  const [salesPlan, setSalesPlan] = useState<SalesPlan>({ avg_check: 17000, calls_per_day: 40, target_conversion: 12, plan_orders_per_day: 5, plan_revenue_per_day: 85000 })
  const [motivation, setMotivation] = useState<MotivationSettings>({
    rates: { carpets: 1, furniture: 1.5, curtains: 1.5, repeat: 3, dryClean: 0.5, blankets: 1.5 },
    repeatShare: 30,
    jackpot: 50000,
    plans: {}
  })
  
  // SIP Extension
  const [sipExtension, setSipExtension] = useState('')
  const [savingSip, setSavingSip] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [managers, setManagers] = useState<ManagerProfile[]>([])
  const [managersLoading, setManagersLoading] = useState(false)
  const [managersError, setManagersError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const admin = getUserRole(user) === 'admin'
        setIsAdmin(admin)
        setSipExtension(user.user_metadata?.sip_extension || user.user_metadata?.sip_number || '')
        if (admin) {
          setManagersLoading(true)
          getManagersProfiles()
            .then((profiles) => {
              setManagers(profiles.filter((p) => p.role === 'manager'))
            })
            .catch((err: unknown) => {
              setManagersError(err instanceof Error ? err.message : 'Ошибка загрузки менеджеров')
            })
            .finally(() => setManagersLoading(false))
        }
      }
    })
    getSettings().then((s) => {
      setDiscounts(s.discounts)
      setScripts(s.scripts)
      setDayTarget(s.dayTarget)
      setSalesPlan(s.salesPlan)
      
      const mc = s.motivationConfig
      setMotivation({
        rates: {
          carpets: Math.round(mc.rates.carpets * 100),
          furniture: Math.round(mc.rates.furniture * 100),
          curtains: Math.round(mc.rates.curtains * 100),
          repeat: Math.round(mc.rates.repeat * 100),
          dryClean: Math.round((mc.rates.dryClean ?? 0.005) * 100),
          blankets: Math.round((mc.rates.blankets ?? 0.015) * 100),
        },
        repeatShare: Math.round(mc.repeatShare * 100),
        jackpot: mc.jackpot,
        plans: mc.plans
      })
      setLoading(false)
    })
  }, [supabase])

  const handleSaveSip = async () => {
    setSavingSip(true)
    const { error } = await supabase.auth.updateUser({
      data: { sip_extension: sipExtension.trim() }
    })
    if (error) {
      toast.error(`Ошибка сохранения SIP: ${error.message}`)
    } else {
      toast.success('Личный SIP-номер сохранен')
    }
    setSavingSip(false)
  }

  const handleSaveDiscounts = async () => {
    setSaving(true)
    const res = await updateSetting('discounts', discounts)
    if (res.success) toast.success('Скидки сохранены')
    else toast.error(res.error)
    setSaving(false)
  }

  const handleSaveMotivation = async () => {
    setSaving(true)
    const dbMotivation = {
      rates: {
        carpets: motivation.rates.carpets / 100,
        furniture: motivation.rates.furniture / 100,
        curtains: motivation.rates.curtains / 100,
        repeat: motivation.rates.repeat / 100,
        dryClean: (motivation.rates.dryClean ?? 0.5) / 100,
        blankets: (motivation.rates.blankets ?? 1.5) / 100,
      },
      repeatShare: motivation.repeatShare / 100,
      jackpot: motivation.jackpot,
      plans: motivation.plans
    }
    const res = await updateSetting('motivation_config', dbMotivation)
    if (res.success) toast.success('Настройки мотивации сохранены')
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
    <div className="max-w-2xl animate-in fade-in duration-200">
      <h1 className="text-2xl font-bold mb-6">Настройки CRM</h1>

      {/* Личные настройки */}
      <section className="mb-6 rounded-xl border border-[#ebe9e4] bg-white shadow-sm p-5">
        <h2 className="text-lg font-semibold mb-1">Личные настройки</h2>
        <p className="text-xs text-muted-foreground mb-3">Настройки вашего рабочего места в CRM</p>
        <div className="flex items-center gap-3">
          <div className="flex-1 max-w-xs">
            <Label htmlFor="sip-extension" className="text-xs mb-1 block">Внутренний номер телефона (SIP)</Label>
            <Input
              id="sip-extension"
              type="text"
              placeholder="Например, 101"
              value={sipExtension}
              onChange={(e) => setSipExtension(e.target.value)}
              className="h-9 focus-visible:ring-1 focus-visible:ring-primary"
            />
          </div>
          <Button size="sm" onClick={handleSaveSip} disabled={savingSip} className="mt-5">
            {savingSip ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </section>
      {isAdmin && (
        <>
          {/* Скидки */}
          <section className="mb-6 rounded-xl border bg-card shadow-sm p-5">
            <h2 className="text-lg font-semibold mb-3">Скидки по сегментам (%)</h2>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(SEGMENT_LABELS) as Array<keyof Discounts>).map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <Label htmlFor={`discount-${key}`} className="w-28 text-sm">{SEGMENT_LABELS[key]}</Label>
                  <Input
                    id={`discount-${key}`}
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
                <Label htmlFor="plan-avg-check" className="text-sm mb-1 block">Средний чек, ₸</Label>
                <Input id="plan-avg-check" type="number" min={0} value={salesPlan.avg_check}
                  onChange={(e) => setSalesPlan({ ...salesPlan, avg_check: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <Label htmlFor="plan-conversion" className="text-sm mb-1 block">Цель конверсии, %</Label>
                <Input id="plan-conversion" type="number" min={1} max={100} value={salesPlan.target_conversion}
                  onChange={(e) => setSalesPlan({ ...salesPlan, target_conversion: Number(e.target.value) || 1 })} />
              </div>
              <div>
                <Label htmlFor="plan-orders" className="text-sm mb-1 block">Заказов в день</Label>
                <Input id="plan-orders" type="number" min={1} value={salesPlan.plan_orders_per_day}
                  onChange={(e) => setSalesPlan({ ...salesPlan, plan_orders_per_day: Number(e.target.value) || 1 })} />
              </div>
              <div>
                <Label htmlFor="plan-revenue" className="text-sm mb-1 block">Выручка в день, ₸</Label>
                <Input id="plan-revenue" type="number" min={0} value={salesPlan.plan_revenue_per_day}
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

          {/* Настройки мотивации и планов */}
          <section className="mb-6 rounded-xl border bg-card shadow-sm p-5">
            <h2 className="text-lg font-semibold mb-3">Настройки мотивации и планов менеджеров</h2>
            
            {/* Базовые проценты премий */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2 text-muted-foreground">Проценты премий от выручки</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="rate-carpets" className="text-xs mb-1 block">Ковры (Новые), %</Label>
                  <Input id="rate-carpets" type="number" min={0} max={100} step={0.1}
                    value={motivation.rates.carpets}
                    onChange={(e) => setMotivation({
                      ...motivation,
                      rates: { ...motivation.rates, carpets: Number(e.target.value) || 0 }
                    })} />
                </div>
                <div>
                  <Label htmlFor="rate-furniture" className="text-xs mb-1 block">Мебель (Новые), %</Label>
                  <Input id="rate-furniture" type="number" min={0} max={100} step={0.1}
                    value={motivation.rates.furniture}
                    onChange={(e) => setMotivation({
                      ...motivation,
                      rates: { ...motivation.rates, furniture: Number(e.target.value) || 0 }
                    })} />
                </div>
                <div>
                  <Label htmlFor="rate-curtains" className="text-xs mb-1 block">Шторы (Новые), %</Label>
                  <Input id="rate-curtains" type="number" min={0} max={100} step={0.1}
                    value={motivation.rates.curtains}
                    onChange={(e) => setMotivation({
                      ...motivation,
                      rates: { ...motivation.rates, curtains: Number(e.target.value) || 0 }
                    })} />
                </div>
                <div>
                  <Label htmlFor="rate-repeat" className="text-xs mb-1 block">Повторные клиенты, %</Label>
                  <Input id="rate-repeat" type="number" min={0} max={100} step={0.1}
                    value={motivation.rates.repeat}
                    onChange={(e) => setMotivation({
                      ...motivation,
                      rates: { ...motivation.rates, repeat: Number(e.target.value) || 0 }
                    })} />
                </div>
                <div>
                  <Label htmlFor="rate-dryclean" className="text-xs mb-1 block">Самовывоз, %</Label>
                  <Input id="rate-dryclean" type="number" min={0} max={100} step={0.1}
                    value={motivation.rates.dryClean ?? 0.5}
                    onChange={(e) => setMotivation({
                      ...motivation,
                      rates: { ...motivation.rates, dryClean: Number(e.target.value) || 0 }
                    })} />
                </div>
                <div>
                  <Label htmlFor="rate-blankets" className="text-xs mb-1 block">Пледы / Одеяла, %</Label>
                  <Input id="rate-blankets" type="number" min={0} max={100} step={0.1}
                    value={motivation.rates.blankets ?? 1.5}
                    onChange={(e) => setMotivation({
                      ...motivation,
                      rates: { ...motivation.rates, blankets: Number(e.target.value) || 0 }
                    })} />
                </div>
              </div>
            </div>

            {/* Джекпот и доля повторных */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <Label htmlFor="jackpot" className="text-xs mb-1 block">Джекпот (Бонус за 100% планов), ₸</Label>
                <Input id="jackpot" type="number" min={0}
                  value={motivation.jackpot}
                  onChange={(e) => setMotivation({ ...motivation, jackpot: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <Label htmlFor="repeat-share" className="text-xs mb-1 block">Целевая доля повторных в выручке, %</Label>
                <Input id="repeat-share" type="number" min={0} max={100}
                  value={motivation.repeatShare}
                  onChange={(e) => setMotivation({ ...motivation, repeatShare: Number(e.target.value) || 0 })} />
              </div>
            </div>

            {/* Индивидуальные планы менеджеров */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2 text-muted-foreground">Планы менеджеров на месяц (₸)</h3>
              {managersLoading && (
                <p className="text-sm text-muted-foreground py-2">Загрузка менеджеров...</p>
              )}
              {!managersLoading && managersError && (
                <p className="text-sm text-destructive py-2">{managersError}</p>
              )}
              {!managersLoading && !managersError && managers.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">Менеджеры не найдены</p>
              )}
              {!managersLoading && !managersError && managers.map((mgr) => {
                const mgrName = mgr.name ?? mgr.email
                return (
                <div key={mgr.id} className="mb-4 p-3 border border-[#ebe9e4]/60 bg-[#fcfcfb] rounded-lg">
                  <div className="font-semibold text-sm mb-2 text-foreground">{mgrName}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor={`plan-${mgrName}-carpets`} className="text-[10px] mb-0.5 block">Ковры (План)</Label>
                      <Input id={`plan-${mgrName}-carpets`} type="number" min={0}
                        value={motivation.plans[mgrName]?.carpets ?? 0}
                        onChange={(e) => {
                          const newPlans = { ...motivation.plans }
                          newPlans[mgrName] = { ...(newPlans[mgrName] || {}), carpets: Number(e.target.value) || 0 }
                          setMotivation({ ...motivation, plans: newPlans })
                        }} />
                    </div>
                    <div>
                      <Label htmlFor={`plan-${mgrName}-furniture`} className="text-[10px] mb-0.5 block">Мебель (План)</Label>
                      <Input id={`plan-${mgrName}-furniture`} type="number" min={0}
                        value={motivation.plans[mgrName]?.furniture ?? 0}
                        onChange={(e) => {
                          const newPlans = { ...motivation.plans }
                          newPlans[mgrName] = { ...(newPlans[mgrName] || {}), furniture: Number(e.target.value) || 0 }
                          setMotivation({ ...motivation, plans: newPlans })
                        }} />
                    </div>
                    <div>
                      <Label htmlFor={`plan-${mgrName}-curtains`} className="text-[10px] mb-0.5 block">Шторы (План)</Label>
                      <Input id={`plan-${mgrName}-curtains`} type="number" min={0}
                        value={motivation.plans[mgrName]?.curtains ?? 0}
                        onChange={(e) => {
                          const newPlans = { ...motivation.plans }
                          newPlans[mgrName] = { ...(newPlans[mgrName] || {}), curtains: Number(e.target.value) || 0 }
                          setMotivation({ ...motivation, plans: newPlans })
                        }} />
                    </div>
                    <div>
                      <Label htmlFor={`plan-${mgrName}-repeat`} className="text-[10px] mb-0.5 block">Повторные (План)</Label>
                      <Input id={`plan-${mgrName}-repeat`} type="number" min={0}
                        value={motivation.plans[mgrName]?.repeat ?? 0}
                        onChange={(e) => {
                          const newPlans = { ...motivation.plans }
                          newPlans[mgrName] = { ...(newPlans[mgrName] || {}), repeat: Number(e.target.value) || 0 }
                          setMotivation({ ...motivation, plans: newPlans })
                        }} />
                    </div>
                    <div>
                      <Label htmlFor={`plan-${mgrName}-dryclean`} className="text-[10px] mb-0.5 block">Самовывоз (План)</Label>
                      <Input id={`plan-${mgrName}-dryclean`} type="number" min={0}
                        value={motivation.plans[mgrName]?.dryClean ?? 0}
                        onChange={(e) => {
                          const newPlans = { ...motivation.plans }
                          newPlans[mgrName] = { ...(newPlans[mgrName] || {}), dryClean: Number(e.target.value) || 0 }
                          setMotivation({ ...motivation, plans: newPlans })
                        }} />
                    </div>
                    <div>
                      <Label htmlFor={`plan-${mgrName}-blankets`} className="text-[10px] mb-0.5 block">Пледы/Одеяла (План)</Label>
                      <Input id={`plan-${mgrName}-blankets`} type="number" min={0}
                        value={motivation.plans[mgrName]?.blankets ?? 0}
                        onChange={(e) => {
                          const newPlans = { ...motivation.plans }
                          newPlans[mgrName] = { ...(newPlans[mgrName] || {}), blankets: Number(e.target.value) || 0 }
                          setMotivation({ ...motivation, plans: newPlans })
                        }} />
                    </div>
                  </div>
                </div>
                )
              })}
            </div>

            <Button size="sm" onClick={handleSaveMotivation} disabled={saving}>
              Сохранить настройки мотивации
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
                  <Label htmlFor={`script-${key}`} className="mb-1 block text-sm font-medium">{segName}</Label>
                  <Textarea
                    id={`script-${key}`}
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
        </>
      )}
    </div>
  )
}

