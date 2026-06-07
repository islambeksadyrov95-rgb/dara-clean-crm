'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { getSalesPlans, saveSalesPlans, type ManagerSalesPlan } from './actions'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const MONTHS = [
  { value: 1, label: 'Январь' },
  { value: 2, label: 'Февраль' },
  { value: 3, label: 'Март' },
  { value: 4, label: 'Апрель' },
  { value: 5, label: 'Май' },
  { value: 6, label: 'Июнь' },
  { value: 7, label: 'Июль' },
  { value: 8, label: 'Август' },
  { value: 9, label: 'Сентябрь' },
  { value: 10, label: 'Октябрь' },
  { value: 11, label: 'Ноябрь' },
  { value: 12, label: 'Декабрь' },
]

const YEARS = [2025, 2026, 2027, 2028]

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

export default function SalesPlansPage() {
  const supabase = createClient()
  
  // Текущая дата по умолчанию
  const now = new Date()
  const [month, setMonth] = useState<number>(now.getMonth() + 1)
  const [year, setYear] = useState<number>(now.getFullYear())
  
  const [plans, setPlans] = useState<ManagerSalesPlan[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Получаем роль текущего пользователя
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setIsAdmin(user.user_metadata?.role === 'admin')
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Загрузка планов
  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await getSalesPlans(month, year)
      setPlans(data)
      setLoading(false)
    }
    load()
  }, [month, year])

  const handleValueChange = (managerId: string, field: keyof ManagerSalesPlan, value: string) => {
    const numericValue = Math.max(0, Number(value) || 0)
    setPlans(prev =>
      prev.map(p => {
        if (p.managerId === managerId) {
          return { ...p, [field]: numericValue }
        }
        return p
      })
    )
  }

  const handleSave = async () => {
    setSaving(true)
    const payload = plans.map(p => ({
      managerId: p.managerId,
      carpetsTarget: p.carpetsTarget,
      furnitureTarget: p.furnitureTarget,
      curtainsTarget: p.curtainsTarget,
      repeatTarget: p.repeatTarget,
      dryCleanTarget: p.dryCleanTarget,
      blanketsTarget: p.blanketsTarget,
    }))

    const res = await saveSalesPlans(month, year, payload)
    if (res.success) {
      toast.success('Планы продаж успешно сохранены')
      // Обновляем статус exists у планов
      setPlans(prev => prev.map(p => ({ ...p, exists: true })))
    } else {
      toast.error(res.error)
    }
    setSaving(false)
  }

  // Расчет общих планов отдела
  const totalCarpets = plans.reduce((sum, p) => sum + p.carpetsTarget, 0)
  const totalFurniture = plans.reduce((sum, p) => sum + p.furnitureTarget, 0)
  const totalCurtains = plans.reduce((sum, p) => sum + p.curtainsTarget, 0)
  const totalRepeat = plans.reduce((sum, p) => sum + p.repeatTarget, 0)
  const totalDryClean = plans.reduce((sum, p) => sum + p.dryCleanTarget, 0)
  const totalBlankets = plans.reduce((sum, p) => sum + p.blanketsTarget, 0)
  const grandTotal = totalCarpets + totalFurniture + totalCurtains + totalRepeat + totalDryClean + totalBlankets

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">План продаж</h1>
          <p className="text-muted-foreground text-sm">
            Установка ежемесячных индивидуальных целей для менеджеров
          </p>
        </div>

        {/* Селекторы периода */}
        <div className="flex items-center gap-2 bg-white border border-[#ebe9e4] p-1.5 rounded-lg shadow-2xs">
          <Select value={String(month)} onValueChange={(val) => setMonth(Number(val))}>
            <SelectTrigger className="w-[130px] h-8 border-0 shadow-none focus:ring-0">
              <SelectValue placeholder="Месяц" />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m) => (
                <SelectItem key={m.value} value={String(m.value)}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="w-px h-5 bg-[#ebe9e4]" />

          <Select value={String(year)} onValueChange={(val) => setYear(Number(val))}>
            <SelectTrigger className="w-[100px] h-8 border-0 shadow-none focus:ring-0">
              <SelectValue placeholder="Год" />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Карточки суммарного плана отдела */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardContent className="pt-4 pb-4">
            <div className="text-[10px] font-semibold text-[#8a877e] uppercase tracking-wider mb-0.5">Ковры (Отдел)</div>
            <div className="text-lg font-bold text-foreground">{fmtMoney.format(totalCarpets)} ₸</div>
          </CardContent>
        </Card>
        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardContent className="pt-4 pb-4">
            <div className="text-[10px] font-semibold text-[#8a877e] uppercase tracking-wider mb-0.5">Мебель (Отдел)</div>
            <div className="text-lg font-bold text-foreground">{fmtMoney.format(totalFurniture)} ₸</div>
          </CardContent>
        </Card>
        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardContent className="pt-4 pb-4">
            <div className="text-[10px] font-semibold text-[#8a877e] uppercase tracking-wider mb-0.5">Шторы (Отдел)</div>
            <div className="text-lg font-bold text-foreground">{fmtMoney.format(totalCurtains)} ₸</div>
          </CardContent>
        </Card>
        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardContent className="pt-4 pb-4">
            <div className="text-[10px] font-semibold text-[#8a877e] uppercase tracking-wider mb-0.5">Самовывоз (Отдел)</div>
            <div className="text-lg font-bold text-foreground">{fmtMoney.format(totalDryClean)} ₸</div>
          </CardContent>
        </Card>
        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardContent className="pt-4 pb-4">
            <div className="text-[10px] font-semibold text-[#8a877e] uppercase tracking-wider mb-0.5">Пледы/Одеяла (Отдел)</div>
            <div className="text-lg font-bold text-foreground">{fmtMoney.format(totalBlankets)} ₸</div>
          </CardContent>
        </Card>
        <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl">
          <CardContent className="pt-4 pb-4">
            <div className="text-[10px] font-semibold text-[#8a877e] uppercase tracking-wider mb-0.5">Повторные (Отдел)</div>
            <div className="text-lg font-bold text-foreground">{fmtMoney.format(totalRepeat)} ₸</div>
          </CardContent>
        </Card>
        <Card className="border-[#ebe9e4] bg-[#fcfcfb] shadow-sm rounded-xl border-dashed col-span-2 sm:col-span-3 lg:col-span-1">
          <CardContent className="pt-4 pb-4">
            <div className="text-[10px] font-semibold text-[#8a877e] uppercase tracking-wider mb-0.5">Общий план отдела</div>
            <div className="text-lg font-bold text-primary">{fmtMoney.format(grandTotal)} ₸</div>
          </CardContent>
        </Card>
      </div>

      {/* Таблица планов */}
      <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-[#ebe9e4]/60 bg-[#fcfcfb]">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Планы менеджеров</CardTitle>
              <CardDescription className="text-xs">
                Период: {MONTHS.find(m => m.value === month)?.label} {year} года
              </CardDescription>
            </div>
            {isAdmin && plans.length > 0 && (
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Сохранение...' : 'Сохранить планы'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Загрузка планов...</div>
          ) : plans.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Активные менеджеры не найдены в системе
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-[#fcfcfb]">
                <TableRow className="border-[#ebe9e4]">
                  <TableHead className="font-semibold">Менеджер</TableHead>
                  <TableHead className="font-semibold text-right w-36">Ковры, ₸</TableHead>
                  <TableHead className="font-semibold text-right w-36">Мебель, ₸</TableHead>
                  <TableHead className="font-semibold text-right w-36">Шторы, ₸</TableHead>
                  <TableHead className="font-semibold text-right w-36">Самовывоз, ₸</TableHead>
                  <TableHead className="font-semibold text-right w-36">Пледы/Одеяла, ₸</TableHead>
                  <TableHead className="font-semibold text-right w-36">Повторные, ₸</TableHead>
                  <TableHead className="font-semibold text-right w-36">Итого план, ₸</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((p) => {
                  const managerTotal = p.carpetsTarget + p.furnitureTarget + p.curtainsTarget + p.repeatTarget + p.dryCleanTarget + p.blanketsTarget
                  return (
                    <TableRow key={p.managerId} className="border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/30">
                      <TableCell className="font-medium">
                        <div className="text-sm font-semibold">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground">{p.email}</div>
                      </TableCell>
                      
                      <TableCell className="text-right">
                        {isAdmin ? (
                          <Input
                            type="number"
                            value={p.carpetsTarget || ''}
                            onChange={(e) => handleValueChange(p.managerId, 'carpetsTarget', e.target.value)}
                            className="text-right h-8 text-sm focus-visible:ring-1 focus-visible:ring-primary"
                            placeholder="0"
                          />
                        ) : (
                          <span className="text-sm font-medium">{fmtMoney.format(p.carpetsTarget)} ₸</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {isAdmin ? (
                          <Input
                            type="number"
                            value={p.furnitureTarget || ''}
                            onChange={(e) => handleValueChange(p.managerId, 'furnitureTarget', e.target.value)}
                            className="text-right h-8 text-sm focus-visible:ring-1 focus-visible:ring-primary"
                            placeholder="0"
                          />
                        ) : (
                          <span className="text-sm font-medium">{fmtMoney.format(p.furnitureTarget)} ₸</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {isAdmin ? (
                          <Input
                            type="number"
                            value={p.curtainsTarget || ''}
                            onChange={(e) => handleValueChange(p.managerId, 'curtainsTarget', e.target.value)}
                            className="text-right h-8 text-sm focus-visible:ring-1 focus-visible:ring-primary"
                            placeholder="0"
                          />
                        ) : (
                          <span className="text-sm font-medium">{fmtMoney.format(p.curtainsTarget)} ₸</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {isAdmin ? (
                          <Input
                            type="number"
                            value={p.dryCleanTarget || ''}
                            onChange={(e) => handleValueChange(p.managerId, 'dryCleanTarget', e.target.value)}
                            className="text-right h-8 text-sm focus-visible:ring-1 focus-visible:ring-primary"
                            placeholder="0"
                          />
                        ) : (
                          <span className="text-sm font-medium">{fmtMoney.format(p.dryCleanTarget)} ₸</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {isAdmin ? (
                          <Input
                            type="number"
                            value={p.blanketsTarget || ''}
                            onChange={(e) => handleValueChange(p.managerId, 'blanketsTarget', e.target.value)}
                            className="text-right h-8 text-sm focus-visible:ring-1 focus-visible:ring-primary"
                            placeholder="0"
                          />
                        ) : (
                          <span className="text-sm font-medium">{fmtMoney.format(p.blanketsTarget)} ₸</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {isAdmin ? (
                          <Input
                            type="number"
                            value={p.repeatTarget || ''}
                            onChange={(e) => handleValueChange(p.managerId, 'repeatTarget', e.target.value)}
                            className="text-right h-8 text-sm focus-visible:ring-1 focus-visible:ring-primary"
                            placeholder="0"
                          />
                        ) : (
                          <span className="text-sm font-medium">{fmtMoney.format(p.repeatTarget)} ₸</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right font-bold text-foreground text-sm">
                        {fmtMoney.format(managerTotal)} ₸
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
