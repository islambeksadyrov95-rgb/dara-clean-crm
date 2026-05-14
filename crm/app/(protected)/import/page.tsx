'use client'

export const dynamic = 'force-dynamic'

import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { normalizePhone } from '@/lib/normalize-phone'
import { importClients, type ClientRow, type ImportResult } from './actions'

type Status = 'idle' | 'parsing' | 'uploading' | 'done' | 'error'

// Поиск колонки по частичному совпадению имени (русский, регистронезависимо)
function findCol(headers: string[], ...keywords: string[]): number {
  return headers.findIndex((h) => {
    const low = (h || '').toLowerCase()
    return keywords.some((kw) => low.includes(kw))
  })
}

// Группировка строк Excel по телефону → агрегация в ClientRow[]
function parseExcel(data: ArrayBuffer): {
  clients: ClientRow[]
  skipped: number
} {
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
    raw: false,
  })

  if (rows.length < 2) return { clients: [], skipped: 0 }

  const headers = rows[0].map((h) => String(h))
  const iDate = findCol(headers, 'дата')
  const iName = findCol(headers, 'имя', 'клиент', 'заказчик', 'фио')
  const iPhone = findCol(headers, 'телефон', 'тел', 'phone')
  const iAddress = findCol(headers, 'адрес', 'address')
  const iAmount = findCol(headers, 'стоимость', 'сумма', 'итого', 'amount')

  if (iPhone === -1) {
    throw new Error('Не найдена колонка с телефоном')
  }

  // Группировка по нормализованному телефону
  const map = new Map<
    string,
    { name: string; address: string | null; orders: number; spent: number; lastDate: string | null }
  >()
  let skipped = 0

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const rawPhone = String(row[iPhone] || '').trim()
    if (!rawPhone) {
      skipped++
      continue
    }

    const phone = normalizePhone(rawPhone)
    if (!phone) {
      skipped++
      continue
    }

    const amount = iAmount !== -1 ? parseFloat(String(row[iAmount]).replace(/[^\d.,]/g, '').replace(',', '.')) || 0 : 0
    const name = iName !== -1 ? String(row[iName] || '').trim() : ''
    const address = iAddress !== -1 ? String(row[iAddress] || '').trim() || null : null

    // Дата заказа
    let orderDate: string | null = null
    if (iDate !== -1) {
      const raw = String(row[iDate] || '').trim()
      if (raw) {
        // Пробуем DD.MM.YYYY и YYYY-MM-DD
        const dotMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/)
        if (dotMatch) {
          orderDate = `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`
        } else {
          const d = new Date(raw)
          if (!isNaN(d.getTime())) {
            orderDate = d.toISOString().slice(0, 10)
          }
        }
      }
    }

    const existing = map.get(phone)
    if (existing) {
      existing.orders++
      existing.spent += amount
      if (!existing.name && name) existing.name = name
      if (!existing.address && address) existing.address = address
      if (orderDate) {
        if (!existing.lastDate || orderDate > existing.lastDate) {
          existing.lastDate = orderDate
        }
      }
    } else {
      map.set(phone, {
        name: name || 'Без имени',
        address,
        orders: 1,
        spent: amount,
        lastDate: orderDate,
      })
    }
  }

  const clients: ClientRow[] = []
  for (const [phone, c] of map) {
    clients.push({
      name: c.name,
      phone,
      address: c.address,
      total_orders: c.orders,
      total_spent: Math.round(c.spent * 100) / 100,
      avg_order_value: c.orders > 0 ? Math.round((c.spent / c.orders) * 100) / 100 : 0,
      last_order_date: c.lastDate,
    })
  }

  return { clients, skipped }
}

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [parseInfo, setParseInfo] = useState<{ total: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload() {
    const file = fileRef.current?.files?.[0]
    if (!file) return

    setStatus('parsing')
    setError(null)
    setResult(null)
    setParseInfo(null)

    try {
      const buffer = await file.arrayBuffer()
      const { clients, skipped } = parseExcel(buffer)

      if (clients.length === 0) {
        setError('Нет валидных записей для импорта')
        setStatus('error')
        return
      }

      setParseInfo({ total: clients.length, skipped })
      setStatus('uploading')
      setProgress(0)

      // Отправляем пакетами по 500 для отображения прогресса
      const BATCH = 500
      const totalBatches = Math.ceil(clients.length / BATCH)
      const combined: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }

      for (let i = 0; i < totalBatches; i++) {
        const batch = clients.slice(i * BATCH, (i + 1) * BATCH)
        const batchResult = await importClients(batch)
        combined.created += batchResult.created
        combined.updated += batchResult.updated
        combined.skipped += batchResult.skipped
        combined.errors.push(...batchResult.errors)
        setProgress(Math.round(((i + 1) / totalBatches) * 100))
      }

      setResult(combined)
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
      setStatus('error')
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Импорт клиентов</h1>
        <p className="text-muted-foreground text-sm">
          Загрузите файл «База Агбис.xlsx» для импорта клиентской базы
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Выбор файла</CardTitle>
          <CardDescription>
            Excel файл с колонками: телефон, имя, адрес, дата заказа, стоимость
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground file:text-sm file:font-medium file:cursor-pointer"
            disabled={status === 'parsing' || status === 'uploading'}
          />
          <Button
            onClick={handleUpload}
            disabled={status === 'parsing' || status === 'uploading'}
          >
            {status === 'parsing'
              ? 'Парсинг...'
              : status === 'uploading'
                ? 'Загрузка...'
                : 'Импортировать'}
          </Button>
        </CardContent>
      </Card>

      {/* Прогресс */}
      {status === 'uploading' && (
        <Card>
          <CardContent className="pt-4">
            {parseInfo && (
              <p className="text-sm text-muted-foreground mb-2">
                Найдено клиентов: {parseInfo.total} (пропущено строк: {parseInfo.skipped})
              </p>
            )}
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className="bg-primary h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-1">{progress}%</p>
          </CardContent>
        </Card>
      )}

      {/* Результат */}
      {status === 'done' && result && (
        <Card>
          <CardHeader>
            <CardTitle>Импорт завершён</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-green-600">{result.created}</p>
                <p className="text-sm text-muted-foreground">Создано</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-600">{result.updated}</p>
                <p className="text-sm text-muted-foreground">Обновлено</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-600">{result.skipped}</p>
                <p className="text-sm text-muted-foreground">Пропущено</p>
              </div>
            </div>
            {parseInfo && (
              <p className="text-sm text-muted-foreground mt-3">
                Пропущено строк при парсинге: {parseInfo.skipped}
              </p>
            )}
            {result.errors.length > 0 && (
              <div className="mt-3 text-sm text-destructive">
                {result.errors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Ошибка */}
      {status === 'error' && error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
