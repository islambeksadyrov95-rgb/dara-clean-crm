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
import { normalizePhone } from '@/lib/phone'
import { importClients, type ClientRow, type ImportResult } from './actions'
import type { ParsedImportOrder } from '@/types/order-history'

type Status = 'idle' | 'parsing' | 'preview' | 'uploading' | 'done' | 'error'

// Сводка распознанных колонок для превью (имя исходного заголовка или null)
interface RecognizedColumns {
  date: string | null
  name: string | null
  phone: string | null
  address: string | null
  amount: string | null
  service: string | null
}

// Результат парсинга Excel: клиенты + плоский список заказов + счётчики
interface ParseResult {
  clients: ClientRow[]
  orders: ParsedImportOrder[]
  skipped: number
  zeroAmountCount: number
  totalRows: number
  columns: RecognizedColumns
}

// Поиск колонки по частичному совпадению имени (русский, регистронезависимо)
function findCol(headers: string[], ...keywords: string[]): number {
  return headers.findIndex((h) => {
    const low = (h || '').toLowerCase()
    return keywords.some((kw) => low.includes(kw))
  })
}

// Имя колонки для превью: исходный заголовок или null если не найдена
function colName(headers: string[], idx: number): string | null {
  return idx !== -1 ? String(headers[idx] || '').trim() || null : null
}

// Группировка строк Excel по телефону → агрегация в ClientRow[] + плоский список заказов
function parseExcel(data: ArrayBuffer): ParseResult {
  const empty: ParseResult = {
    clients: [],
    orders: [],
    skipped: 0,
    zeroAmountCount: 0,
    totalRows: 0,
    columns: { date: null, name: null, phone: null, address: null, amount: null, service: null },
  }

  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
    raw: false,
  })

  if (rows.length < 2) return empty

  // Ищем строку заголовков — может быть не первой (Агбис ставит 3 служебные строки)
  let headerIdx = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i].map((h) => String(h || '').toLowerCase())
    if (row.some((h) => h.includes('телефон') || h.includes('phone'))) {
      headerIdx = i
      break
    }
  }

  const headers = rows[headerIdx].map((h) => String(h))
  const iDate = findCol(headers, 'дата')
  const iName = findCol(headers, 'контрагент', 'имя', 'клиент', 'заказчик', 'фио')
  const iPhone = findCol(headers, 'телефон', 'тел', 'phone')
  const iAddress = findCol(headers, 'адрес', 'address')
  const iAmount = findCol(headers, 'стоимость', 'сумма', 'amount')
  const iService = findCol(headers, 'услуга', 'service')

  const columns: RecognizedColumns = {
    date: colName(headers, iDate),
    name: colName(headers, iName),
    phone: colName(headers, iPhone),
    address: colName(headers, iAddress),
    amount: colName(headers, iAmount),
    service: colName(headers, iService),
  }

  if (iPhone === -1) {
    throw new Error('Не найдена колонка с телефоном')
  }

  // Группировка по нормализованному телефону
  const map = new Map<
    string,
    { name: string; address: string | null; orders: number; spent: number; lastDate: string | null }
  >()
  let skipped = 0
  let zeroAmountCount = 0
  let totalRows = 0
  const orders: ParsedImportOrder[] = []
  // Текущая дата группы (Агбис группирует заказы по дате)
  let currentDate: string | null = null

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]

    const firstCol = String(row[0] || '').trim()
    const nameCol = String(row[iName] || '').trim()

    // Сначала проверяем дату в первой колонке (Агбис: "08.07.2025" + "Итого")
    if (firstCol.match(/^\d{2}\.\d{2}\.\d{4}/)) {
      const dotMatch = firstCol.match(/^(\d{2})\.(\d{2})\.(\d{4})/)
      if (dotMatch) {
        currentDate = `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`
      }
    }

    // Пропускаем строки "Итого" и "Общий итог"
    if (nameCol.toLowerCase() === 'итого' || firstCol.toLowerCase().includes('итог')) {
      continue
    }

    // Если строка — только заголовок даты без данных
    if (firstCol.match(/^\d{2}\.\d{2}\.\d{4}/) && !String(row[iPhone] || '').trim()) {
      continue
    }

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
    const service = iService !== -1 ? String(row[iService] || '').trim() || null : null

    // Дата заказа — из строки или из текущей группы
    let orderDate: string | null = null
    if (iDate !== -1) {
      const raw = String(row[iDate] || '').trim()
      if (raw) {
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
    // Используем дату группы если у строки нет своей
    if (!orderDate && currentDate) {
      orderDate = currentDate
    }

    // Валидная строка заказа: собираем плоский список + счётчики
    const roundedAmount = Math.round(amount)
    totalRows++
    if (roundedAmount === 0) zeroAmountCount++
    orders.push({
      phone,
      order_date: orderDate,
      amount: roundedAmount,
      service,
      address,
    })

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
      total_spent: Math.round(c.spent),
      avg_order_value: c.orders > 0 ? Math.round(c.spent / c.orders) : 0,
      last_order_date: c.lastDate,
    })
  }

  return { clients, orders, skipped, zeroAmountCount, totalRows, columns }
}

const PREVIEW_ROWS = 5

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [parseInfo, setParseInfo] = useState<{ total: number; skipped: number } | null>(null)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Шаг 1: парсинг файла → превью (без отправки на сервер)
  async function handleParse() {
    const file = fileRef.current?.files?.[0]
    if (!file) return

    setStatus('parsing')
    setError(null)
    setResult(null)
    setParseInfo(null)
    setParsed(null)

    try {
      const buffer = await file.arrayBuffer()
      const parseResult = parseExcel(buffer)

      if (parseResult.clients.length === 0) {
        setError('Нет валидных записей для импорта')
        setStatus('error')
        return
      }

      setParsed(parseResult)
      setStatus('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
      setStatus('error')
    }
  }

  // Отмена превью: сброс выбранного файла и состояния
  function handleCancel() {
    if (fileRef.current) fileRef.current.value = ''
    setParsed(null)
    setStatus('idle')
  }

  // Шаг 2: подтверждённый импорт клиентов на сервер
  async function handleImport() {
    if (!parsed) return
    const { clients, orders } = parsed

    setParseInfo({ total: clients.length, skipped: parsed.skipped })
    setStatus('uploading')
    setProgress(0)
    setError(null)

    try {
      // PHASE1_ORDERS_ARG: один вызов на весь импорт — import_batch_id и матчинг
      // заказов по phone должны охватывать всю выборку, не чанк. Внутри action
      // upsert/вставка/пересчёт идут батчами по 500.
      const importResult = await importClients(clients, orders)
      setProgress(100)
      setResult(importResult)
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
            onClick={handleParse}
            disabled={status === 'parsing' || status === 'uploading'}
          >
            {status === 'parsing'
              ? 'Парсинг...'
              : status === 'uploading'
                ? 'Загрузка...'
                : 'Разобрать файл'}
          </Button>
        </CardContent>
      </Card>

      {/* Превью перед импортом */}
      {status === 'preview' && parsed && (
        <Card>
          <CardHeader>
            <CardTitle>Превью импорта</CardTitle>
            <CardDescription>
              Проверьте распознанные колонки и данные перед загрузкой
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Распознанные колонки */}
            <div>
              <p className="text-sm font-medium mb-2">Распознанные колонки</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {(
                  [
                    ['Дата', parsed.columns.date],
                    ['Имя', parsed.columns.name],
                    ['Телефон', parsed.columns.phone],
                    ['Адрес', parsed.columns.address],
                    ['Сумма', parsed.columns.amount],
                    ['Услуга', parsed.columns.service],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{label}:</span>
                    <span className={value ? 'font-medium' : 'text-destructive'}>
                      {value ?? 'не найдена'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Счётчики */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <p className="text-lg font-bold">{parsed.totalRows}</p>
                <p className="text-muted-foreground">Всего строк</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-600">{parsed.orders.length}</p>
                <p className="text-muted-foreground">Валидных заказов</p>
              </div>
              <div>
                <p className="text-lg font-bold text-orange-600">{parsed.skipped}</p>
                <p className="text-muted-foreground">Без телефона</p>
              </div>
              <div>
                <p className="text-lg font-bold text-orange-600">{parsed.zeroAmountCount}</p>
                <p className="text-muted-foreground">Нулевая сумма</p>
              </div>
            </div>

            {/* Первые строки заказов */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Телефон</th>
                    <th className="py-1 pr-2 font-medium">Дата</th>
                    <th className="py-1 pr-2 font-medium">Сумма</th>
                    <th className="py-1 pr-2 font-medium">Услуга</th>
                    <th className="py-1 font-medium">Адрес</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.orders.slice(0, PREVIEW_ROWS).map((order, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2">{order.phone}</td>
                      <td className="py-1 pr-2">{order.order_date ?? '—'}</td>
                      <td className="py-1 pr-2">{order.amount}</td>
                      <td className="py-1 pr-2">{order.service ?? '—'}</td>
                      <td className="py-1">{order.address ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3">
              <Button onClick={handleImport}>Импортировать</Button>
              <Button variant="outline" onClick={handleCancel}>
                Отмена
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
            <div className="grid grid-cols-2 gap-4 text-center mt-4 sm:grid-cols-4">
              <div>
                <p className="text-xl font-bold text-green-600">{result.ordersInserted}</p>
                <p className="text-sm text-muted-foreground">Заказов в истории</p>
              </div>
              <div>
                <p className="text-xl font-bold text-orange-600">{result.zeroAmountOrders}</p>
                <p className="text-sm text-muted-foreground">Нулевая сумма</p>
              </div>
              <div>
                <p className="text-xl font-bold text-orange-600">{result.unmatchedOrders}</p>
                <p className="text-sm text-muted-foreground">Без клиента/даты</p>
              </div>
              <div>
                <p className="text-xs font-mono break-all text-muted-foreground">{result.batchId ?? '—'}</p>
                <p className="text-sm text-muted-foreground">ID импорта</p>
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
