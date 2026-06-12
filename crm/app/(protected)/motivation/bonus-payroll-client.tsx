'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { getBonusesPayroll, type BonusPayroll } from './actions'

const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const fmtPercent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

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

const CSV_HEADERS = [
  'Менеджер',
  'Email',
  'Выручка, ₸',
  'Выполнение, %',
  'Джекпот',
  'К выплате, ₸',
]

function buildCsv(data: BonusPayroll): string {
  const escape = (value: string | number): string => {
    const str = String(value)
    if (str.includes('"') || str.includes(';') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const lines: string[] = []
  lines.push(CSV_HEADERS.map(escape).join(';'))

  data.rows.forEach((row) => {
    lines.push(
      [
        escape(row.name),
        escape(row.email),
        escape(row.totalRevenue),
        escape(fmtPercent.format(row.avgAchievement)),
        escape(row.isJackpotEarned ? 'Да' : 'Нет'),
        escape(row.totalPayout),
      ].join(';')
    )
  })

  lines.push(
    [escape('ИТОГО'), '', escape(data.totalRevenue), '', '', escape(data.totalPayout)].join(';')
  )

  return lines.join('\r\n')
}

function downloadCsv(content: string, fileName: string): void {
  // UTF-8 BOM, чтобы Excel корректно прочитал кириллицу
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function BonusPayrollClient() {
  const now = new Date()
  const [month, setMonth] = useState<number>(now.getMonth() + 1)
  const [year, setYear] = useState<number>(now.getFullYear())
  const [data, setData] = useState<BonusPayroll | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await getBonusesPayroll(month, year)
        if (!cancelled) setData(res)
      } catch (err) {
        if (!cancelled) {
          setError('Не удалось загрузить ведомость бонусов')
          toast.error('Ошибка загрузки ведомости')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [month, year])

  const handleExport = () => {
    if (!data || data.rows.length === 0) {
      toast.error('Нет данных для экспорта')
      return
    }
    const monthStr = String(month).padStart(2, '0')
    downloadCsv(buildCsv(data), `bonuses-${year}-${monthStr}.csv`)
    toast.success('Ведомость выгружена в CSV')
  }

  const monthLabel = MONTHS.find((m) => m.value === month)?.label

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ведомость бонусов</h1>
          <p className="text-muted-foreground text-sm">
            Премии всех менеджеров за {monthLabel} {year}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="px-3 py-1 bg-white text-[13px] border-[#ebe9e4] text-[#5c5950] h-8">
            Роль: Руководитель
          </Badge>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={loading || !data || data.rows.length === 0}
            className="bg-white border-[#ebe9e4] text-[#5c5950] h-8 text-xs"
          >
            Экспорт CSV
          </Button>

          <div className="flex items-center gap-2 bg-white border border-[#ebe9e4] p-1 rounded-lg shadow-2xs h-8">
            <Select value={String(month)} onValueChange={(val) => setMonth(Number(val))}>
              <SelectTrigger className="w-[110px] h-6 border-0 shadow-none focus:ring-0 text-xs px-2">
                <SelectValue placeholder="Месяц" />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="w-px h-4 bg-[#ebe9e4]" />

            <Select value={String(year)} onValueChange={(val) => setYear(Number(val))}>
              <SelectTrigger className="w-[80px] h-6 border-0 shadow-none focus:ring-0 text-xs px-2">
                <SelectValue placeholder="Год" />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={String(y)} className="text-xs">
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Card className="border-[#ebe9e4] bg-white shadow-sm rounded-xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-[#ebe9e4]/60 bg-[#fcfcfb]">
          <CardTitle className="text-base font-semibold">
            Премии за {monthLabel} {year}
          </CardTitle>
          <CardDescription className="text-xs">
            {data && !data.hasRevenue
              ? 'За выбранный месяц нет выручки — ведомость показывает только % выполнения планов'
              : 'Фактический бонус по единой формуле калькулятора'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>Загрузка ведомости за {monthLabel} {year}...</span>
            </div>
          ) : error ? (
            <div className="py-16 text-center text-red-600 text-sm">{error}</div>
          ) : !data || data.rows.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              Активные менеджеры не найдены в системе
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-[#fcfcfb]">
                <TableRow className="border-[#ebe9e4] hover:bg-transparent">
                  <TableHead className="font-semibold">Менеджер</TableHead>
                  <TableHead className="font-semibold text-right">Выручка</TableHead>
                  <TableHead className="font-semibold text-right">Выполнение</TableHead>
                  <TableHead className="font-semibold text-center">Джекпот</TableHead>
                  <TableHead className="font-semibold text-right">К выплате</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={row.managerId} className="border-[#ebe9e4]/60 hover:bg-[#fcfcfb]/30">
                    <TableCell className="font-medium">
                      <div className="text-sm font-semibold">{row.name}</div>
                      <div className="text-[10px] text-muted-foreground">{row.email}</div>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {data.hasRevenue ? `${fmtMoney.format(row.totalRevenue)} ₸` : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {row.hasPlans ? `${fmtPercent.format(row.avgAchievement)}%` : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.isJackpotEarned ? (
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0 h-5">
                          Да
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-[#8a877e] border-[#e7e4dd]">
                          Нет
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-bold text-foreground text-sm">
                      {data.hasRevenue ? `${fmtMoney.format(row.totalPayout)} ₸` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {data && data.rows.length > 0 && data.hasRevenue && (
          <div className="border-t border-[#ebe9e4] bg-[#fcfcfb] px-6 py-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-[#5c5950]">
              Итого к выплате ({data.rows.length} менеджеров)
            </span>
            <span className="text-xl font-extrabold text-foreground">
              {fmtMoney.format(data.totalPayout)} ₸
            </span>
          </div>
        )}
      </Card>
    </div>
  )
}
