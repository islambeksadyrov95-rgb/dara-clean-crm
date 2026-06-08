'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { 
  getBroadcastClients, 
  generateBroadcastMessage, 
  sendWhatsAppMessage, 
  logBroadcastAttempt, 
  getBroadcastLogs,
  getTemplates,
  createTemplate,
  deleteTemplate,
  type BroadcastLogEntry
} from './actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { SEGMENT_COLORS } from '@/lib/segments'
import { toast } from 'sonner'
import { 
  Play, 
  Pause, 
  Square, 
  Loader2, 
  Trash2, 
  Plus, 
  AlertTriangle, 
  Send, 
  RefreshCw, 
  History, 
  Users,
  CheckCircle,
  XCircle,
  FileText
} from 'lucide-react'

type Client = {
  id: string
  name: string
  phone: string
  address: string | null
  total_orders: number
  total_spent: number
  last_order_date: string | null
  rfm_segment: string
  days_since_last_order: number | null
}

type CustomTemplate = {
  id: string
  title: string
  category: string
}

// Статические сценарии согласно скриншоту
const SCENARIOS = {
  season: [
    { id: 's1', label: 'После зимы' },
    { id: 's2', label: 'Лето: пыль и пух' },
    { id: 's3', label: 'Осень: к отопительному сезону' },
    { id: 's4', label: 'Зима: сухой воздух и пыль' }
  ],
  holidays: [
    { id: 'h1', label: 'Наурыз (22 марта)' },
    { id: 'h2', label: 'Новый год' },
    { id: 'h3', label: 'Ораза/Курбан айт' },
    { id: 'h4', label: 'Той / большое застолье' }
  ],
  reasons: [
    { id: 'r1', label: 'После ремонта / переезда' },
    { id: 'r2', label: 'Маленькие дети' },
    { id: 'r3', label: 'Домашние животные' },
    { id: 'r4', label: 'После гостей / застолья' }
  ],
  pains: [
    { id: 'p1', label: 'Пятно не выводится' },
    { id: 'p2', label: 'Ковёр впитал запах' },
    { id: 'p3', label: 'Потускневший ковёр' },
    { id: 'p4', label: 'Нет времени чистить самим' }
  ],
  other: [
    { id: 'o1', label: 'Узнать впечатления' },
    { id: 'o2', label: 'Напомнить об услуге' }
  ]
}

const SEGMENTS = ['Все', 'Новый', 'Повторный', 'Постоянный', 'В риске', 'Потерянный'] as const
const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU')
}

// Ограничения WhatsApp и интервал
const SEND_INTERVAL_SEC = 25 // 25 секунд пауза между отправками

export default function BroadcastsPage() {
  const supabase = createSupabaseClient()

  // Вкладки
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create')

  // Состояние поиска и клиентов
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [segment, setSegment] = useState<string>('Все')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loadingClients, setLoadingClients] = useState(true)

  // Кастомные предложения
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([])
  const [newTemplateTitle, setNewTemplateTitle] = useState('')
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false)

  // История логов
  const [broadcastLogs, setBroadcastLogs] = useState<BroadcastLogEntry[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  // Настройка рассылки
  const [selectedScenario, setSelectedScenario] = useState<string>('')
  const [sendAutomatically, setSendAutomatically] = useState<boolean>(true)
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false)

  // Состояние процесса рассылки
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const [progressItems, setProgressItems] = useState<{
    clientId: string
    name: string
    phone: string
    status: 'pending' | 'generating' | 'generated' | 'sending' | 'sent' | 'failed'
    text: string
    error?: string
  }[]>([])
  
  // Для автоотправщика
  const [currentIndex, setCurrentIndex] = useState<number>(0)
  const [countdown, setCountdown] = useState<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Ручной режим (редактирование текстов перед отправкой)
  const [showManualScreen, setShowManualScreen] = useState<boolean>(false)

  // Ссылка на дебаунс поиска
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Загрузка клиентов
  const fetchClients = useCallback(async () => {
    setLoadingClients(true)
    const res = await getBroadcastClients({
      search: debouncedSearch,
      segment: segment
    })
    if (res.success) {
      setClients(res.clients as Client[])
    } else {
      toast.error(res.error)
    }
    setLoadingClients(false)
  }, [debouncedSearch, segment])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  // Загрузка шаблонов и истории
  const loadTemplatesAndLogs = useCallback(async () => {
    const tmpls = await getTemplates()
    setCustomTemplates(tmpls as CustomTemplate[])

    if (activeTab === 'history') {
      setLoadingLogs(true)
      const logs = await getBroadcastLogs()
      setBroadcastLogs(logs)
      setLoadingLogs(false)
    }
  }, [activeTab])

  useEffect(() => {
    loadTemplatesAndLogs()
  }, [loadTemplatesAndLogs])

  // Дебаунс поиска
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  // Очистка выбора при смене фильтра
  useEffect(() => {
    setSelectedIds([])
  }, [segment, debouncedSearch])

  // Создание нового кастомного сценария
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTemplateTitle.trim()) return

    setIsCreatingTemplate(true)
    const res = await createTemplate(newTemplateTitle)
    if (res.success) {
      toast.success('Предложение успешно создано')
      setNewTemplateTitle('')
      loadTemplatesAndLogs()
    } else {
      toast.error(res.error)
    }
    setIsCreatingTemplate(false)
  }

  // Удаление кастомного сценария
  const handleDeleteTemplate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Удалить это предложение?')) return

    const res = await deleteTemplate(id)
    if (res.success) {
      toast.success('Предложение удалено')
      loadTemplatesAndLogs()
      if (selectedScenario === id) setSelectedScenario('')
    } else {
      toast.error(res.error)
    }
  }

  // Запуск рассылки из модалки настроек
  const handleStartBroadcast = async () => {
    if (!selectedScenario) {
      toast.error('Выберите сценарий сообщения')
      return
    }

    const selectedClients = clients.filter(c => selectedIds.includes(c.id))
    if (selectedClients.length === 0) {
      toast.error('Выберите хотя бы одного клиента')
      return
    }

    setShowConfigModal(false)

    // Инициализируем элементы прогресса
    const initialItems = selectedClients.map(c => ({
      clientId: c.id,
      name: c.name,
      phone: c.phone,
      status: 'pending' as const,
      text: ''
    }))

    setProgressItems(initialItems)
    setCurrentIndex(0)
    setIsPaused(false)

    if (sendAutomatically) {
      // Автоматический режим с паузами
      setIsProcessing(true)
      setShowManualScreen(false)
    } else {
      // Ручной режим: сначала генерируем ВСЕ сообщения, а потом даем редактировать
      setShowManualScreen(true)
      setIsProcessing(true)
      // Начинаем фоновую генерацию всех текстов
      generateAllTextsSequentially(initialItems)
    }
  }

  // Генерация текстов для всех клиентов в ручном режиме
  const generateAllTextsSequentially = async (items: typeof progressItems) => {
    const updatedItems = [...items]
    
    for (let i = 0; i < updatedItems.length; i++) {
      updatedItems[i].status = 'generating'
      setProgressItems([...updatedItems])

      const res = await generateBroadcastMessage(updatedItems[i].clientId, selectedScenario)
      
      if (res.success) {
        updatedItems[i].status = 'generated'
        updatedItems[i].text = res.text
      } else {
        updatedItems[i].status = 'failed'
        updatedItems[i].error = res.error || 'Ошибка ИИ'
      }
      setProgressItems([...updatedItems])
    }
    setIsProcessing(false) // Генерация завершена, менеджер может редактировать и отправлять
  }

  // Запуск/продолжение автоматического цикла отправки
  useEffect(() => {
    if (!isProcessing || isPaused || !sendAutomatically) return

    const runAutoCycle = async () => {
      const items = [...progressItems]
      
      if (currentIndex >= items.length) {
        // Рассылка завершена!
        setIsProcessing(false)
        toast.success('Автоматическая рассылка полностью завершена!')
        setSelectedIds([])
        loadTemplatesAndLogs()
        return
      }

      const currentItem = items[currentIndex]
      
      // Шаг 1. Генерация сообщения ИИ
      currentItem.status = 'generating'
      setProgressItems([...items])

      console.log(`Generating AI message for ${currentItem.name}...`)
      const genRes = await generateBroadcastMessage(currentItem.clientId, selectedScenario)
      
      if (!genRes.success) {
        currentItem.status = 'failed'
        currentItem.error = genRes.error || 'Ошибка ИИ-генерации'
        setProgressItems([...items])
        await logBroadcastAttempt({
          clientId: currentItem.clientId,
          scenario: selectedScenario,
          messageText: '',
          status: 'failed',
          errorMessage: currentItem.error
        })
        // Переходим к следующему
        setCurrentIndex(prev => prev + 1)
        return
      }

      currentItem.text = genRes.text
      currentItem.status = 'sending'
      setProgressItems([...items])

      // Шаг 2. Отправка сообщения
      console.log(`Sending WhatsApp message to ${currentItem.name} (${currentItem.phone})...`)
      const sendRes = await sendWhatsAppMessage(currentItem.phone, genRes.text)

      if (sendRes.success) {
        currentItem.status = 'sent'
        setProgressItems([...items])
        await logBroadcastAttempt({
          clientId: currentItem.clientId,
          scenario: selectedScenario,
          messageText: genRes.text,
          status: 'sent'
        })
      } else {
        currentItem.status = 'failed'
        currentItem.error = sendRes.error || 'Ошибка отправки WhatsApp'
        setProgressItems([...items])
        await logBroadcastAttempt({
          clientId: currentItem.clientId,
          scenario: selectedScenario,
          messageText: genRes.text,
          status: 'failed',
          errorMessage: currentItem.error
        })
      }

      // Шаг 3. Запуск паузы перед следующим
      const nextIndex = currentIndex + 1
      if (nextIndex < items.length) {
        setCountdown(SEND_INTERVAL_SEC)
        
        // Очищаем старые таймеры
        if (countdownRef.current) clearInterval(countdownRef.current)
        
        countdownRef.current = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              if (countdownRef.current) clearInterval(countdownRef.current)
              setCurrentIndex(nextIndex)
              return 0
            }
            return prev - 1
          })
        }, 1000)
      } else {
        // Это был последний элемент
        setCurrentIndex(nextIndex)
      }
    }

    runAutoCycle()

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [isProcessing, isPaused, currentIndex, sendAutomatically]) // eslint-disable-line react-hooks/exhaustive-deps

  // Остановка рассылки
  const handleStopProcess = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setIsProcessing(false)
    setIsPaused(false)
    toast.info('Рассылка остановлена менеджером')
  }

  // Одиночная ручная отправка сообщения (в ручном режиме)
  const handleManualSendSingle = async (idx: number) => {
    const items = [...progressItems]
    const item = items[idx]

    if (!item.text.trim()) {
      toast.error('Текст сообщения пуст')
      return
    }

    item.status = 'sending'
    setProgressItems([...items])

    const res = await sendWhatsAppMessage(item.phone, item.text)
    if (res.success) {
      item.status = 'sent'
      setProgressItems([...items])
      await logBroadcastAttempt({
        clientId: item.clientId,
        scenario: selectedScenario,
        messageText: item.text,
        status: 'sent'
      })
      toast.success(`Сообщение отправлено ${item.name}`)
    } else {
      item.status = 'failed'
      item.error = res.error || 'Ошибка отправки'
      setProgressItems([...items])
      await logBroadcastAttempt({
        clientId: item.clientId,
        scenario: selectedScenario,
        messageText: item.text,
        status: 'failed',
        errorMessage: item.error
      })
      toast.error(`Ошибка при отправке сообщения ${item.name}: ${res.error}`)
    }
  }

  // Перегенерация одиночного сообщения в ручном режиме
  const handleManualRegenerateSingle = async (idx: number) => {
    const items = [...progressItems]
    const item = items[idx]

    item.status = 'generating'
    item.text = ''
    setProgressItems([...items])

    const res = await generateBroadcastMessage(item.clientId, selectedScenario)
    if (res.success) {
      item.status = 'generated'
      item.text = res.text
    } else {
      item.status = 'failed'
      item.error = res.error || 'Ошибка генерации'
    }
    setProgressItems([...items])
  }

  // Отправить все оставшиеся сообщения по очереди в ручном режиме (с паузами)
  const handleSendAllManual = async () => {
    const items = [...progressItems]
    setShowManualScreen(false)
    setSendAutomatically(true)
    
    // Находим первый неотправленный элемент
    const firstPendingIdx = items.findIndex(item => item.status === 'generated' || item.status === 'pending')
    if (firstPendingIdx === -1) {
      toast.error('Нет сообщений готовых к отправке')
      return
    }

    setCurrentIndex(firstPendingIdx)
    setIsProcessing(true)
    setIsPaused(false)
  }

  // Очистка счетчиков при закрытии
  const handleCloseProgressModal = () => {
    if (isProcessing) {
      if (!confirm('Рассылка еще выполняется. Вы уверены, что хотите закрыть окно? Прогресс будет прерван.')) {
        return;
      }
      handleStopProcess()
    }
    setProgressItems([])
    setSelectedIds([])
    setShowManualScreen(false)
  }

  return (
    <div className="space-y-6">
      {/* Шапка и Вкладки */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#ebe9e4] pb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Рассылки клиентам</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Умная ИИ-рассылка WhatsApp для возврата и прогрева клиентов</p>
        </div>
        <div className="flex bg-[#f3f2ee] rounded-lg p-0.5 self-start">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'create'
                ? 'bg-white text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Запуск рассылки
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-white text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <History className="w-3.5 h-3.5" /> История рассылок
          </button>
        </div>
      </div>

      {/* Вкладка Запуска Рассылки */}
      {activeTab === 'create' && !showManualScreen && (
        <div className="space-y-6">
          {/* Предупреждающий ИИ-баннер */}
          <div className="flex gap-3 p-4 bg-orange-50 border border-orange-200 rounded-xl text-orange-800 text-xs shadow-xs">
            <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold block text-[13px]">Безопасность рассылок в WhatsApp</span>
              <p className="leading-relaxed">
                Каждое сообщение ИИ делает уникальным и «живым» — без цен, прайс-листов и спам-слов, с вопросом и мягким opt-out. Отправка идет поочередно с паузой в 25 секунд, чтобы алгоритмы WhatsApp не сочли это спам-активностью. Не запускайте рассылки слишком часто и большими партиями.
              </p>
            </div>
          </div>

          {/* Фильтры и Панель Действий */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center justify-between">
            <div className="flex flex-wrap gap-2.5">
              <Input
                placeholder="Поиск по имени или телефону..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs h-9 text-xs"
              />
              <div className="flex bg-[#f3f2ee] rounded-lg p-0.5 border border-[#ebe9e4]">
                {SEGMENTS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSegment(s)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      segment === s
                        ? 'bg-white text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Кнопка запуска при выбранных чекбоксах */}
            <Button
              onClick={() => setShowConfigModal(true)}
              disabled={selectedIds.length === 0}
              className="bg-[#2563eb] hover:bg-blue-700 h-9 px-4 text-xs font-semibold shadow-md shrink-0 flex items-center gap-1.5 self-start md:self-auto"
            >
              <Send className="w-3.5 h-3.5" /> Настроить рассылку ({selectedIds.length})
            </Button>
          </div>

          {/* Таблица клиентов */}
          <div className="rounded-xl border border-[#ebe9e4] bg-white shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#fcfcfb]">
                  <TableHead className="w-12 text-center">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 accent-primary cursor-pointer h-4 w-4 align-middle"
                      checked={clients.length > 0 && clients.every(c => selectedIds.includes(c.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(clients.map((c) => c.id))
                        } else {
                          setSelectedIds([])
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Имя клиента</TableHead>
                  <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Телефон</TableHead>
                  <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Сегмент</TableHead>
                  <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3 text-right">Заказов</TableHead>
                  <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3 text-right">Выручка</TableHead>
                  <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Посл. заказ</TableHead>
                  <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3 text-right">Дней назад</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingClients ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-xs text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-muted-foreground" />
                      Загрузка клиентов...
                    </TableCell>
                  </TableRow>
                ) : clients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-xs text-muted-foreground">
                      Клиенты не найдены по заданным фильтрам
                    </TableCell>
                  </TableRow>
                ) : (
                  clients.map((c) => (
                    <TableRow
                      key={c.id}
                      className={`hover:bg-muted/30 cursor-pointer ${selectedIds.includes(c.id) ? 'bg-blue-50/20' : ''}`}
                      onClick={() => {
                        setSelectedIds(prev => 
                          prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                        )
                      }}
                    >
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 accent-primary cursor-pointer h-4 w-4 align-middle"
                          checked={selectedIds.includes(c.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds((prev) => [...prev, c.id])
                            } else {
                              setSelectedIds((prev) => prev.filter((id) => id !== c.id))
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-semibold text-foreground text-[13px]">{c.name}</TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">{c.phone}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] font-bold px-2 py-0.5 ${SEGMENT_COLORS[c.rfm_segment] ?? ''}`}>
                          {c.rfm_segment}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-[13px] font-medium">{c.total_orders}</TableCell>
                      <TableCell className="text-right text-[13px] font-semibold text-foreground">
                        {fmtMoney.format(c.total_spent)} ₸
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">{formatDate(c.last_order_date)}</TableCell>
                      <TableCell className="text-right text-[13px] font-medium text-orange-600">
                        {c.days_since_last_order != null ? `${c.days_since_last_order} дн.` : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Вкладка Истории Рассылок */}
      {activeTab === 'history' && (
        <div className="rounded-xl border border-[#ebe9e4] bg-white shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fcfcfb]">
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Клиент</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Сценарий</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Текст сообщения</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Менеджер</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Статус</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] py-3">Дата отправки</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingLogs ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-xs text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-muted-foreground" />
                    Загрузка истории...
                  </TableCell>
                </TableRow>
              ) : broadcastLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-xs text-muted-foreground">
                    История рассылок пуста
                  </TableCell>
                </TableRow>
              ) : (
                broadcastLogs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-muted/10">
                    <TableCell>
                      <div className="font-semibold text-foreground text-[13px]">{log.client_name}</div>
                      <div className="text-[11px] text-muted-foreground">{log.client_phone}</div>
                    </TableCell>
                    <TableCell className="text-[12px] font-medium">{log.scenario}</TableCell>
                    <TableCell className="text-[12px] max-w-xs truncate text-muted-foreground" title={log.message_text}>
                      {log.message_text || '—'}
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{log.manager_name}</TableCell>
                    <TableCell>
                      {log.status === 'sent' ? (
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] flex items-center gap-1 w-fit">
                          <CheckCircle className="w-3 h-3 text-emerald-600" /> Отправлено
                        </Badge>
                      ) : (
                        <div className="space-y-1">
                          <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px] flex items-center gap-1 w-fit">
                            <XCircle className="w-3 h-3 text-red-600" /> Ошибка
                          </Badge>
                          {log.error_message && (
                            <p className="text-[10px] text-red-500 max-w-[150px] truncate" title={log.error_message}>
                              {log.error_message}
                            </p>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">
                      {new Date(log.sent_at).toLocaleString('ru-RU')}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Экран Ручного Режима (Менеджер редактирует сообщения перед отправкой) */}
      {showManualScreen && (
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-[#ebe9e4] pb-4">
            <div>
              <h2 className="text-xl font-bold text-foreground">Проверка ИИ-сообщений перед отправкой</h2>
              <p className="text-xs text-muted-foreground">Отредактируйте сгенерированные тексты и отправьте их клиентам</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCloseProgressModal}
                className="text-xs font-semibold"
              >
                Отменить
              </Button>
              <Button
                size="sm"
                onClick={handleSendAllManual}
                className="bg-[#2563eb] hover:bg-blue-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Отправить все по очереди с паузами
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {progressItems.map((item, idx) => (
              <div 
                key={item.clientId}
                className={`border rounded-xl p-4 bg-white shadow-xs space-y-3 relative overflow-hidden transition-all ${
                  item.status === 'sent' ? 'border-emerald-200 bg-emerald-50/5' :
                  item.status === 'failed' ? 'border-red-200 bg-red-50/5' : 'border-[#ebe9e4]'
                }`}
              >
                {/* Шапка карточки клиента */}
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-[14px] text-foreground">{item.name}</h4>
                    <span className="text-[11px] text-muted-foreground">{item.phone}</span>
                  </div>
                  <div>
                    {item.status === 'generating' && (
                      <Badge className="bg-blue-50 text-blue-700 border-blue-100 text-[10px] flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin text-blue-600" /> Генерация...
                      </Badge>
                    )}
                    {item.status === 'generated' && (
                      <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200 text-[10px]">
                        Готово к проверке
                      </Badge>
                    )}
                    {item.status === 'sending' && (
                      <Badge className="bg-blue-50 text-blue-700 border-blue-100 text-[10px] flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin text-blue-600" /> Отправка...
                      </Badge>
                    )}
                    {item.status === 'sent' && (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-emerald-600" /> Отправлено
                      </Badge>
                    )}
                    {item.status === 'failed' && (
                      <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px] flex items-center gap-1" title={item.error}>
                        <XCircle className="w-3 h-3 text-red-600" /> Ошибка
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Текст сообщения */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#a8a49a]">Текст WhatsApp сообщения:</label>
                  <textarea
                    value={item.text}
                    onChange={(e) => {
                      const updated = [...progressItems]
                      updated[idx].text = e.target.value
                      setProgressItems(updated)
                    }}
                    rows={4}
                    disabled={item.status === 'sending' || item.status === 'sent' || item.status === 'generating'}
                    className="w-full text-[13px] border border-[#ebe9e4] rounded-lg p-2.5 bg-[#fcfcfb] focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-75 resize-none leading-relaxed"
                    placeholder="Здесь появится сгенерированный текст сообщения..."
                  />
                </div>

                {/* Действия в карточке */}
                <div className="flex justify-end gap-2 pt-1.5 border-t border-[#ebe9e4]/60">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleManualRegenerateSingle(idx)}
                    disabled={item.status === 'generating' || item.status === 'sending' || item.status === 'sent'}
                    className="h-8 text-xs text-muted-foreground flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Перегенерировать
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleManualSendSingle(idx)}
                    disabled={item.status !== 'generated' && item.status !== 'failed'}
                    className="h-8 bg-[#2563eb] hover:bg-blue-700 text-xs flex items-center gap-1 shadow-xs"
                  >
                    <Send className="w-3 h-3" /> Отправить
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Модальное окно Настройки Рассылки (Конфигуратор) */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white border border-[#ebe9e4] rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto overflow-x-hidden animate-in zoom-in-95 duration-200">
            {/* Шапка модалки */}
            <div className="px-5 py-4 border-b border-[#ebe9e4]/60 bg-[#fcfcfb] flex justify-between items-center sticky top-0 z-10">
              <div>
                <h3 className="font-extrabold text-[15px] text-foreground">Запуск рассылки</h3>
                <p className="text-[11px] text-muted-foreground">Настройка сценария и режима отправки</p>
              </div>
              <button onClick={() => setShowConfigModal(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            {/* Контент модалки */}
            <div className="p-5 space-y-5">
              {/* Предупреждение о количестве клиентов */}
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-blue-800 text-[11px] font-semibold flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600 shrink-0" />
                Выбрано клиентов для рассылки: {selectedIds.length}
              </div>

              {/* Выбор сценария */}
              <div className="space-y-4">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] block">Сценарий сообщения:</label>
                
                {/* 1. Сезон */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-[#8a877e] font-semibold block">Сезон</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SCENARIOS.season.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedScenario(s.label)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                          selectedScenario === s.label
                            ? 'bg-[#2563eb] text-white border-blue-600'
                            : 'bg-[#f7f6f3] text-[#5c5950] border-[#e7e4dd] hover:bg-white'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Праздники */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-[#8a877e] font-semibold block">Праздники</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SCENARIOS.holidays.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedScenario(s.label)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                          selectedScenario === s.label
                            ? 'bg-[#2563eb] text-white border-blue-600'
                            : 'bg-[#f7f6f3] text-[#5c5950] border-[#e7e4dd] hover:bg-white'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Поводы */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-[#8a877e] font-semibold block">Поводы</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SCENARIOS.reasons.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedScenario(s.label)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                          selectedScenario === s.label
                            ? 'bg-[#2563eb] text-white border-blue-600'
                            : 'bg-[#f7f6f3] text-[#5c5950] border-[#e7e4dd] hover:bg-white'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. Боли */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-[#8a877e] font-semibold block">Боли</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SCENARIOS.pains.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedScenario(s.label)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                          selectedScenario === s.label
                            ? 'bg-[#2563eb] text-white border-blue-600'
                            : 'bg-[#f7f6f3] text-[#5c5950] border-[#e7e4dd] hover:bg-white'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 5. Прочее */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-[#8a877e] font-semibold block">Прочее</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SCENARIOS.other.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedScenario(s.label)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                          selectedScenario === s.label
                            ? 'bg-[#2563eb] text-white border-blue-600'
                            : 'bg-[#f7f6f3] text-[#5c5950] border-[#e7e4dd] hover:bg-white'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 6. Мои предложения (пользовательские сценарии) */}
                <div className="space-y-1.5 border-t border-[#ebe9e4]/60 pt-3">
                  <span className="text-[11px] text-[#8a877e] font-semibold block">Мои предложения</span>
                  <div className="flex flex-wrap gap-1.5">
                    {customTemplates.map(tmpl => (
                      <div
                        key={tmpl.id}
                        onClick={() => setSelectedScenario(tmpl.title)}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-all flex items-center gap-1.5 cursor-pointer ${
                          selectedScenario === tmpl.title
                            ? 'bg-[#2563eb] text-white border-blue-600'
                            : 'bg-[#f7f6f3] text-[#5c5950] border-[#e7e4dd] hover:bg-white'
                        }`}
                      >
                        <span>{tmpl.title}</span>
                        <button
                          onClick={(e) => handleDeleteTemplate(tmpl.id, e)}
                          className="text-red-500 hover:text-red-700 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Инпут создания предложения */}
                  <form onSubmit={handleCreateTemplate} className="flex gap-2 mt-2">
                    <Input
                      placeholder="Свой сценарий..."
                      value={newTemplateTitle}
                      onChange={(e) => setNewTemplateTitle(e.target.value)}
                      className="h-8 text-xs max-w-[200px]"
                    />
                    <Button 
                      type="submit" 
                      size="sm" 
                      disabled={isCreatingTemplate || !newTemplateTitle.trim()} 
                      className="h-8 text-xs px-3 bg-foreground hover:opacity-95"
                    >
                      <Plus className="w-3.5 h-3.5" /> Создать
                    </Button>
                  </form>
                </div>
              </div>

              {/* Выбранный сценарий */}
              {selectedScenario && (
                <div className="p-3 bg-muted/50 border border-dashed border-[#ebe9e4] rounded-xl text-xs">
                  <span className="font-semibold text-muted-foreground block">Выбранный сценарий:</span>
                  <p className="font-bold text-foreground mt-0.5">{selectedScenario}</p>
                </div>
              )}

              {/* Переключатель режима автоотправки */}
              <div className="flex items-center justify-between p-4 border border-[#ebe9e4] rounded-2xl bg-[#fcfcfb] shadow-xs">
                <div className="space-y-0.5 max-w-[70%]">
                  <span className="text-[13px] font-bold text-foreground">Отправить автоматически</span>
                  <p className="text-[10px] text-muted-foreground leading-normal">
                    Система сама сгенерирует сообщения через ИИ и отправит их по WhatsApp с безопасным интервалом в 25 секунд.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendAutomatically}
                    onChange={(e) => setSendAutomatically(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {/* Кнопки */}
              <div className="flex gap-2 justify-end pt-3 border-t border-[#ebe9e4]/60">
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowConfigModal(false)}
                  className="text-xs font-semibold"
                >
                  Отмена
                </Button>
                <Button 
                  type="button" 
                  size="sm" 
                  onClick={handleStartBroadcast}
                  disabled={!selectedScenario}
                  className="bg-[#2563eb] hover:bg-blue-700 text-xs font-semibold px-4 shadow-md flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Сгенерировать ({selectedIds.length})
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно выполнения автоматической рассылки */}
      {isProcessing && sendAutomatically && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white border border-[#ebe9e4] rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Шапка модалки */}
            <div className="px-5 py-4 border-b border-[#ebe9e4]/60 bg-[#fcfcfb] flex justify-between items-center">
              <div>
                <h3 className="font-extrabold text-[15px] text-foreground flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  Выполнение рассылки WhatsApp
                </h3>
                <p className="text-[11px] text-muted-foreground">Не закрывайте эту страницу до окончания процесса</p>
              </div>
              <button onClick={handleCloseProgressModal} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            {/* Контент модалки */}
            <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
              
              {/* Прогресс-бар */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                  <span>Отправлено {currentIndex} из {progressItems.length}</span>
                  <span>{Math.round((currentIndex / progressItems.length) * 100)}%</span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden border">
                  <div 
                    className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                    style={{ width: `${(currentIndex / progressItems.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Таймер обратного отсчета */}
              {countdown > 0 && !isPaused && (
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                  <span className="text-xs font-semibold text-emerald-800">
                    Пауза перед отправкой следующего сообщения: <span className="font-extrabold text-sm text-emerald-600">{countdown} сек.</span>
                  </span>
                  <div className="w-full h-1 bg-emerald-200 mt-2 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 transition-all duration-1000"
                      style={{ width: `${(countdown / SEND_INTERVAL_SEC) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Кнопки управления */}
              <div className="flex gap-2 justify-center">
                {isPaused ? (
                  <Button 
                    size="sm" 
                    onClick={() => setIsPaused(false)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold flex items-center gap-1.5 shadow-xs"
                  >
                    <Play className="w-3.5 h-3.5" /> Продолжить
                  </Button>
                ) : (
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => setIsPaused(true)}
                    className="text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Pause className="w-3.5 h-3.5" /> Пауза
                  </Button>
                )}
                <Button 
                  size="sm" 
                  variant="destructive"
                  onClick={handleStopProcess}
                  className="text-xs font-semibold flex items-center gap-1.5 shadow-xs"
                >
                  <Square className="w-3.5 h-3.5" /> Остановить
                </Button>
              </div>

              {/* Детальный лог выполнения */}
              <div className="space-y-2 border-t border-[#ebe9e4]/60 pt-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#a8a49a] block">Лог отправки:</span>
                <div className="bg-[#f7f6f3] border border-[#ebe9e4] rounded-xl p-3 h-48 overflow-y-auto space-y-2 font-mono text-[11px] leading-relaxed">
                  {progressItems.map((item, idx) => {
                    let logText = ''
                    let colorClass = 'text-gray-500'

                    if (item.status === 'pending') {
                      logText = `[Ожидание] Клиент ${item.name} (${item.phone})`
                    } else if (item.status === 'generating') {
                      logText = `[ИИ] Генерация текста для ${item.name}...`
                      colorClass = 'text-blue-600 font-semibold'
                    } else if (item.status === 'sending') {
                      logText = `[Отправка] Отсылаем сообщение на ${item.phone}...`
                      colorClass = 'text-yellow-600'
                    } else if (item.status === 'sent') {
                      logText = `[Успех] Сообщение отправлено ${item.name}. Текст: «${item.text.slice(0, 40)}...»`
                      colorClass = 'text-emerald-600 font-semibold'
                    } else if (item.status === 'failed') {
                      logText = `[Ошибка] Не удалось отправить ${item.name}: ${item.error}`
                      colorClass = 'text-red-600 font-semibold'
                    }

                    return (
                      <div key={item.clientId} className={`${colorClass} truncate`} title={logText}>
                        {logText}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
