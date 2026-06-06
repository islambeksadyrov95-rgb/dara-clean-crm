'use client'

import { useEffect, useState } from 'react'
import { getInboxWhatsAppLogs, type InboxEntry } from './actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Search, RefreshCw, MessageSquare, ExternalLink, Calendar, User, Mail } from 'lucide-react'

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} в ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function InboxPage() {
  const [logs, setLogs] = useState<InboxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const loadData = () => {
    setLoading(true)
    getInboxWhatsAppLogs()
      .then((data) => {
        setLogs(data)
      })
      .catch((err) => {
        console.error('Failed to load inbox data:', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredLogs = logs.filter((log) => {
    const query = searchQuery.toLowerCase().trim()
    if (!query) return true
    return (
      log.clientName.toLowerCase().includes(query) ||
      log.clientPhone.includes(query) ||
      log.managerEmail.toLowerCase().includes(query) ||
      log.templateText.toLowerCase().includes(query)
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Диалоги WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            История отправленных шаблонов WhatsApp для клиентов со статусом &quot;Не дозвонился&quot;
          </p>
        </div>
        <Button
          onClick={loadData}
          variant="outline"
          size="sm"
          className="h-9 w-fit gap-1.5 border-[#ebe9e4] hover:bg-[#f7f6f3]"
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </div>

      {/* Поиск */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Поиск по клиенту, телефону, тексту..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 border-[#ebe9e4] bg-white focus-visible:ring-blue-500"
        />
      </div>

      {/* Таблица */}
      <div className="rounded-xl border border-[#ebe9e4] bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-[#f7f6f3]">
            <TableRow className="border-b border-[#ebe9e4]">
              <TableHead className="font-semibold text-foreground py-3">Дата отправки</TableHead>
              <TableHead className="font-semibold text-foreground py-3">Клиент</TableHead>
              <TableHead className="font-semibold text-foreground py-3">Текст шаблона</TableHead>
              <TableHead className="font-semibold text-foreground py-3">Менеджер</TableHead>
              <TableHead className="font-semibold text-foreground text-right py-3 pr-4">Действие</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span>Загрузка списка отправлений...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <MessageSquare className="h-8 w-8 text-muted-foreground opacity-50" />
                    <span className="font-medium text-foreground">Диалоги не найдены</span>
                    <span className="text-xs">
                      {searchQuery ? 'Попробуйте изменить поисковый запрос' : 'Логи отправки WhatsApp пока отсутствуют'}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredLogs.map((log) => (
                <TableRow key={log.id} className="border-b border-[#ebe9e4] hover:bg-[#fcfcfb]/50">
                  <TableCell className="text-sm text-foreground whitespace-nowrap align-top py-4">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatDateTime(log.createdAt)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="align-top py-4">
                    <div className="space-y-0.5">
                      <div className="font-medium text-foreground flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>{log.clientName}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <a href={`tel:${log.clientPhone}`} className="hover:underline">
                          {log.clientPhone}
                        </a>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-foreground align-top max-w-md py-4">
                    <div className="rounded-lg bg-[#f7f6f3] border border-[#ebe9e4] p-3 text-[13px] leading-relaxed whitespace-pre-line text-[#5c5950]">
                      {log.templateText}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground align-top py-4">
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>{log.managerEmail}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right align-top py-4 pr-4">
                    <a
                      href={log.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block"
                    >
                      <Button
                        size="sm"
                        className="bg-[#25d366] hover:bg-[#20ba5a] text-white gap-1.5 shadow-sm"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Открыть чат
                      </Button>
                    </a>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
