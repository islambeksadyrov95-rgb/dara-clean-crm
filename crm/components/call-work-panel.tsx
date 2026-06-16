'use client'

// ─────────────────────────────────────────────────────────────────────────────
// CallWorkPanel — общая боковая панель работы со звонком.
// Используется на /queue (полный режим: SIP-call-id, заказ/whatsapp-фазы, VPBX-
// записи, снуз) и /clients (упрощённый режим: только диспозиции + закрытие).
// Различия страниц вынесены в props с дефолтами; state-машина callPhase живёт
// ТОЛЬКО внутри этого компонента (см. критерий T3.1 — grep callPhase).
//
// NB: файл намеренно превышает лимит 300 строк (рефактор-исключение T3.1):
// это консолидация двух ранее дублированных панелей в одном месте. Под-блоки
// сгруппированы по фазам диспозиции внутри файла.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { makeSipCall } from '@/lib/vpbx/actions'
import {
  recordDisposition, snoozeClient,
  type CallStatus, type CallSubStatus, type DispositionInput, type SnoozeUntil, type VpbxCallRow,
} from '@/app/(protected)/queue/actions'
import { OrderForm } from '@/app/(protected)/queue/order-form'
import { WhatsAppPanel } from '@/app/(protected)/queue/whatsapp-panel'
import { VpbxCallsPanel } from '@/app/(protected)/queue/vpbx-calls-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Phone, MessageSquare } from 'lucide-react'
import { SEGMENT_COLORS } from '@/lib/segments'
import { WazzupChatModal } from '@/components/wazzup-chat-modal'
import { ClientTags } from '@/components/client-tags'
import { AcquisitionField } from '@/components/acquisition-field'
import { notifyCallbacksChanged } from '@/lib/callback-events'
import type { Discounts } from '@/app/(protected)/settings/actions'

// Глиф-крестик закрытия (U+2715). Построен из кода, т.к. emoji-guard блокирует литерал.
const CLOSE_GLYPH = String.fromCharCode(0x2715)

// ─── Constants ───
const STATUS_LABELS: Record<string, string> = {
  reached: 'Дозвонился', not_reached: 'Не дозвонился',
  callback: 'Перезвонить', declined: 'Отказ', not_relevant: 'Не актуально',
  ordered: 'Заказ', callback_later: 'Перезвон', sent_whatsapp: 'WhatsApp',
  decline_expensive: 'Дорого', decline_competitor: 'Другая компания',
  decline_not_needed: 'Не нужно', decline_quality: 'Качество',
  decline_season: 'Не сезон', decline_other: 'Другое',
  wrong_number: 'Неверный номер', unavailable: 'Недоступен', blocked: 'Заблокировал',
  auto_3_strikes: '3 попытки',
}

const DECLINE_REASONS = [
  { value: 'decline_expensive', label: 'Дорого' },
  { value: 'decline_competitor', label: 'Есть другая компания' },
  { value: 'decline_not_needed', label: 'Не нужно сейчас' },
  { value: 'decline_quality', label: 'Недоволен качеством' },
  { value: 'decline_season', label: 'Не сезон' },
  { value: 'decline_other', label: 'Другое' },
] as const

// Быстрые пресеты времени перезвона: 1 клик вместо ручного ввода даты+времени.
const CALLBACK_PRESETS: { label: string; build: (now: Date) => Date }[] = [
  { label: 'Через 2 ч', build: (now) => new Date(now.getTime() + 2 * 3600_000) },
  { label: 'Завтра 10:00', build: (now) => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d } },
  { label: 'Через неделю', build: (now) => { const d = new Date(now); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0); return d } },
]

const SEGMENT_DISCOUNT_KEY: Record<string, keyof Discounts> = {
  'Новый': 'new', 'Повторный': 'repeat', 'Постоянный': 'regular',
  'В риске': 'at_risk', 'Потерянный': 'lost',
}

// ─── Types ───

// Унифицированный клиент панели. Очередь даёт все поля, /clients — подмножество.
export type CallWorkClient = {
  id: string
  name: string
  phone: string
  address: string | null
  rfm_segment: string
  days_since_last_order: number | null
  total_orders: number
  total_spent: number
  last_order_date: string | null
  sticky_note?: string | null
}

// История звонков: queue даёт audio/score, /clients — manager_name. Оба опц.
export type CallWorkHistoryEntry = {
  id: string
  status: string
  sub_status: string | null
  reason: string | null
  notes: string | null
  created_at: string
  manager_name?: string
  audio_url?: string | null
  call_score?: number | null
  transcript?: string | null
  summary?: string | null
}

type CallPhase = 'level1' | 'reached_actions' | 'not_reached_actions' | 'decline_reason' | 'callback_schedule' | 'order' | 'whatsapp'

export type CallWorkPanelProps = {
  client: CallWorkClient
  callHistory: CallWorkHistoryEntry[]
  attemptCount: number
  // Закрыть панель (крестик / «просто закрыть»).
  onClose: () => void
  // После сохранённой диспозиции: очередь делает «следующий клиент», карточка — закрывает.
  onDispositionDone: () => void

  // ─── Режимные различия (дефолты = поведение /clients) ───
  // Полный поток уровня 1 (queue): плоский список всех действий + заказ/whatsapp фазы.
  // false (/clients): двухкнопочный level1 → reached_actions / not_reached_actions.
  fullDispositionFlow?: boolean
  // Кнопка «Пропустить» + снуз-меню (только очередь).
  showNextClient?: boolean
  onNextClient?: () => void
  // SIP: hasSip-гейтинг кнопки звонка (очередь). На /clients звонок всегда доступен.
  hasSip?: boolean
  // VPBX-записи (очередь). Управляются снаружи (зависят от загрузки/refresh).
  vpbxCalls?: VpbxCallRow[]
  onRefreshVpbx?: () => void
  // Скидки/футер-контекст клиента (очередь).
  discounts?: Discounts
  // Ссылка «Карточка →» в шапке (/clients).
  cardHref?: string | null
  // Цвет сегмент-бейджа: /clients передаёт colorForSegment(config); очередь — дефолт.
  segmentColor?: (seg: string) => string
  // Override-селектор сегмента (admin, /clients).
  segmentOptions?: { value: string; label: string }[]
  onSetSegment?: (override: string | null) => void
  // Слот скрипта сегмента (T3.4): сворачиваемый блок, раскрыт по умолчанию.
  scriptText?: string | null
  // Внешний call-id (очередь, переход из карточки ?call=) — привязка итога к записи vpbx_calls.
  initialCallId?: string | null
}

// <kbd>-бейдж клавиши на кнопке диспозиции (стиль как в order-form).
function KbdHint({ k }: { k: string }) {
  return <kbd className="mr-1.5 text-[10px] opacity-70 border rounded px-1 leading-none py-0.5">{k}</kbd>
}

// Курсор в редактируемом поле — горячие клавиши панели игнорируются.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function CallWorkPanel(props: CallWorkPanelProps) {
  const {
    client, callHistory, attemptCount, onClose, onDispositionDone,
    fullDispositionFlow = false, showNextClient = false, onNextClient,
    hasSip, vpbxCalls, onRefreshVpbx, discounts, cardHref,
    segmentColor, segmentOptions, onSetSegment, scriptText, initialCallId,
  } = props

  const [callPhase, setCallPhase] = useState<CallPhase>('level1')
  const [disposing, setDisposing] = useState(false)
  const [calling, setCalling] = useState(false)
  const [showWazzupModal, setShowWazzupModal] = useState(false)

  // Сворачиваемые блоки
  const [showHistory, setShowHistory] = useState(callHistory.length > 0)
  const [showRecord, setShowRecord] = useState(true)
  const [showScript, setShowScript] = useState(true)
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false)

  // Callback / decline state
  const [cbDate, setCbDate] = useState('')
  const [cbTime, setCbTime] = useState('')
  const [cbNotes, setCbNotes] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [declineText, setDeclineText] = useState('')

  // Пресет перезвона → проставляет дату/время одним кликом (см. CALLBACK_PRESETS).
  const applyCallbackPreset = (build: (now: Date) => Date) => {
    const d = build(new Date())
    const pad = (n: number) => String(n).padStart(2, '0')
    setCbDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    setCbTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
  }

  // ID текущего звонка — связывает итог с записью vpbx_calls (очередь). Источник:
  // ?call= при переходе из карточки (initialCallId) либо externalCallId из makeSipCall.
  // Панель монтируется заново на каждого клиента (key=client.id на странице),
  // поэтому initialCallId как начальное значение корректно сбрасывается между клиентами.
  const [pendingCallId, setPendingCallId] = useState<string | null>(initialCallId ?? null)

  const segColor = segmentColor ? segmentColor(client.rfm_segment) : (SEGMENT_COLORS[client.rfm_segment] ?? '')
  const sipGated = hasSip !== undefined // очередь передаёт hasSip → включаем гейтинг

  // ─── Disposition core ───
  const submitDisposition = async (input: DispositionInput): Promise<boolean> => {
    setDisposing(true)
    const res = await recordDisposition({
      ...input,
      externalCallId: input.externalCallId ?? pendingCallId ?? undefined,
    })
    if (!res.success) { toast.error(res.error); setDisposing(false); return false }
    setDisposing(false)
    // Сообщаем сайдбару пересчитать бейдж перезвонов синхронно (без realtime).
    notifyCallbacksChanged()
    return true
  }

  // ─── SIP call ───
  const handleInitiateSipCall = async () => {
    if (!client || calling) return
    setCalling(true)
    toast.info('Инициируем SIP-звонок...')
    if (fullDispositionFlow) {
      // Очередь: передаём clientId, ловим externalCallId для привязки записи.
      const res = await makeSipCall(client.phone, client.id)
      if (res.success) {
        if (res.externalCallId) setPendingCallId(res.externalCallId)
        toast.success('Звонок инициирован. АТС вызывает ваш телефон. Запись появится автоматически.')
      } else {
        toast.error(res.error)
      }
      setCalling(false)
    } else {
      // /clients: запись подтянется из MicroSIP; разблокируем кнопку сразу.
      try {
        const res = await makeSipCall(client.phone)
        if (!res.success) { toast.error(res.error); return }
        toast.success('Соединяем с клиентом — отвечайте на софтфоне. Запись подтянется из MicroSIP автоматически.')
      } finally {
        setCalling(false)
      }
    }
  }

  // ─── Snooze (очередь) ───
  const handleSnooze = async (until: SnoozeUntil) => {
    setShowSnoozeMenu(false)
    const res = await snoozeClient(client.id, until)
    if (!res.success) { toast.error(res.error); return }
    const labels: Record<SnoozeUntil, string> = { '30m': 'через 30 мин', '2h': 'через 2 часа', tomorrow: 'на завтра' }
    toast.success(`Отложено ${labels[until]}`)
    onNextClient?.()
  }

  // ─── Disposition actions — full flow (очередь) ───
  const handleOrder = async () => {
    if (!await submitDisposition({ clientId: client.id, status: 'reached', subStatus: 'ordered' })) return
    setCallPhase('order')
  }
  const handleWhatsApp = async () => {
    if (!await submitDisposition({ clientId: client.id, status: 'reached', subStatus: 'sent_whatsapp' })) return
    setCallPhase('whatsapp')
  }
  const handleNotReachedWhatsApp = async () => {
    if (!await submitDisposition({ clientId: client.id, status: 'not_reached', subStatus: 'sent_whatsapp' })) return
    setCallPhase('whatsapp')
  }
  const handleWrongNumber = async () => {
    if (!await submitDisposition({ clientId: client.id, status: 'not_relevant', subStatus: 'wrong_number' })) return
    toast.success('Неверный номер — клиент архивирован')
    onDispositionDone()
  }
  const handleUnavailableFull = async () => {
    const nowMs = Date.now()
    const later = new Date(nowMs + 4 * 60 * 60 * 1000)
    const date = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}`
    const time = `${String(later.getHours()).padStart(2, '0')}:${String(later.getMinutes()).padStart(2, '0')}`
    if (!await submitDisposition({ clientId: client.id, status: 'not_reached', subStatus: 'unavailable', nextCallDate: date, nextCallTime: time })) return
    toast.success('Перезвон через 4 часа')
    onDispositionDone()
  }
  const handleBlockedFull = async () => {
    if (!await submitDisposition({ clientId: client.id, status: 'not_reached', subStatus: 'blocked' })) return
    toast.success('Отмечено: заблокировал')
    onDispositionDone()
  }

  // ─── Disposition actions — simple flow (/clients) ───
  const submitSimple = async (status: CallStatus, subStatus?: CallSubStatus) => {
    const ok = await submitDisposition({
      clientId: client.id, status, subStatus,
      nextCallDate: cbDate || undefined, nextCallTime: cbTime || undefined,
      notes: cbNotes || undefined,
      reason: declineReason === 'decline_other' ? declineText : undefined,
    })
    if (!ok) return
    toast.success('Результат звонка зафиксирован')
    onDispositionDone()
  }

  // ─── Shared: decline / callback submit (поведение зависит от режима) ───
  const handleSubmitDecline = async () => {
    if (!declineReason) return
    if (fullDispositionFlow) {
      const ok = await submitDisposition({
        clientId: client.id, status: 'declined', subStatus: declineReason as CallSubStatus,
        reason: declineReason === 'decline_other' ? declineText : undefined,
      })
      if (!ok) return
      toast.success('Отказ сохранён')
      onDispositionDone()
    } else {
      await submitSimple('declined', declineReason as CallSubStatus)
    }
  }
  const handleSubmitCallback = async () => {
    if (!cbDate) return
    if (fullDispositionFlow) {
      const ok = await submitDisposition({
        clientId: client.id, status: 'callback', subStatus: 'callback_later',
        nextCallDate: cbDate, nextCallTime: cbTime || undefined, notes: cbNotes || undefined,
      })
      if (!ok) return
      toast.success(`Перезвон на ${cbDate}${cbTime ? ' ' + cbTime : ''}`)
      onDispositionDone()
    } else {
      await submitSimple('callback', 'callback_later')
    }
  }

  // ─── Hotkeys (T3.2): фаза level1 полного потока (очередь) ───
  // Сматчены с РЕАЛЬНЫМИ кнопками level1: 1=Оформить заказ, 2=Перезвонить позже,
  // 3=Отказ, 4=WhatsApp(дозвонился), 0=Недоступен(не дозвонился), Esc=закрыть.
  // На фазах order/whatsapp цифры обрабатывает вложенная OrderForm/WhatsAppPanel —
  // этот listener активен ТОЛЬКО на level1, поэтому конфликта двух слушателей нет.
  // ref на актуальные обработчики: listener не переподписывается на каждый ввод.
  const hotkeyActions = useRef({
    order: handleOrder, callback: () => setCallPhase('callback_schedule'),
    decline: () => setCallPhase('decline_reason'), whatsapp: handleWhatsApp,
    unavailable: handleUnavailableFull, close: onClose,
  })
  hotkeyActions.current = {
    order: handleOrder, callback: () => setCallPhase('callback_schedule'),
    decline: () => setCallPhase('decline_reason'), whatsapp: handleWhatsApp,
    unavailable: handleUnavailableFull, close: onClose,
  }
  const hotkeysActive = fullDispositionFlow && callPhase === 'level1'

  useEffect(() => {
    if (!hotkeysActive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); hotkeyActions.current.close(); return }
      if (isEditableTarget(e.target) || disposing) return
      const map: Record<string, () => void | Promise<void>> = {
        '1': hotkeyActions.current.order,
        '2': hotkeyActions.current.callback,
        '3': hotkeyActions.current.decline,
        '4': hotkeyActions.current.whatsapp,
        '0': hotkeyActions.current.unavailable,
      }
      const action = map[e.key]
      if (action) { e.preventDefault(); void action() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hotkeysActive, disposing])

  const showFooterContext = fullDispositionFlow

  return (
    <div className="w-96 shrink-0 animate-in slide-in-from-right duration-250">
      <div className="sticky top-6 rounded-xl border border-[#ebe9e4] bg-white shadow-md p-4 space-y-4 max-h-[calc(100vh-4rem)] overflow-y-auto">
        {/* Инфо клиента */}
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <div className="font-bold text-lg text-foreground leading-tight">{client.name}</div>
              {cardHref && (
                <a href={cardHref} className="text-sm text-muted-foreground hover:underline">Карточка →</a>
              )}
            </div>
            <a href={`tel:${client.phone}`} className="text-sm text-muted-foreground hover:underline">{client.phone}</a>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={segColor}>{client.rfm_segment}</Badge>
              {/* «N дн. без заказа» показывала только очередь (full flow). /clients имел только бейдж + select. */}
              {fullDispositionFlow && client.days_since_last_order != null && (
                <span className="text-xs text-muted-foreground">{client.days_since_last_order} дн. без заказа</span>
              )}
              {segmentOptions && onSetSegment && (
                <select
                  className="h-6 rounded border border-input bg-background px-1 text-[11px] cursor-pointer focus:outline-none"
                  defaultValue=""
                  title="Изменить сегмент клиента"
                  onChange={(e) => {
                    const val = e.target.value
                    if (!val) return
                    onSetSegment(val === '__auto__' ? null : val)
                    e.target.value = ''
                  }}
                >
                  <option value="" disabled>Изменить…</option>
                  <option value="__auto__">Авто (по правилам)</option>
                  {segmentOptions.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              )}
              {attemptCount > 0 && <span className="text-xs text-orange-600 font-semibold">Попытка {attemptCount}/3</span>}
            </div>
            {showFooterContext && (
              <div className="text-xs text-muted-foreground mt-1">
                {client.total_orders} заказов &middot; {(client.total_spent ?? 0).toLocaleString('ru-RU')} ₸
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-[#a8a49a] hover:text-foreground">{CLOSE_GLYPH}</button>
        </div>

        {/* Заметка-стикер: закреплённая заметка клиента + последняя заметка из звонка */}
        {showFooterContext && (client.sticky_note || callHistory[0]?.notes) && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 space-y-0.5">
            {client.sticky_note && <div className="font-medium">{client.sticky_note}</div>}
            {callHistory[0]?.notes && <div className="text-amber-700/90 italic">«{callHistory[0].notes}»</div>}
          </div>
        )}

        {/* Теги + источник: общие самодостаточные компоненты (карточка использует те же) */}
        <div className="space-y-1.5">
          <ClientTags clientId={client.id} compact />
          <AcquisitionField clientId={client.id} />
        </div>

        {/* Скрипт сегмента (T3.4): сворачиваемый, раскрыт по умолчанию, только если непустой */}
        {scriptText && scriptText.trim() && (
          <div className="rounded-md border border-blue-100 bg-blue-50/50">
            <button onClick={() => setShowScript((v) => !v)} className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs font-semibold text-blue-800">
              <span>Скрипт</span>
              <span>{showScript ? '▾' : '▸'}</span>
            </button>
            {showScript && (
              <div className="px-2.5 pb-2 text-xs text-blue-900 whitespace-pre-wrap">{scriptText}</div>
            )}
          </div>
        )}

        {/* Действия со SIP телефонией и Wazzup */}
        <div className="flex gap-2">
          <Button
            onClick={handleInitiateSipCall}
            className="flex-1 bg-[#2563eb] hover:bg-blue-700 flex items-center justify-center gap-1.5"
            disabled={calling || (sipGated && !hasSip)}
            title={sipGated && !hasSip ? 'Укажите внутренний SIP-номер в Настройках → Личные настройки' : undefined}
          >
            <Phone className="w-4 h-4" /> Позвонить
          </Button>
          <Button onClick={() => setShowWazzupModal(true)} variant="outline" className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50 flex items-center justify-center gap-1.5">
            <MessageSquare className="w-4 h-4 text-emerald-700" /> Написать
          </Button>
        </div>
        {sipGated && !hasSip && (
          <p className="text-[11px] text-amber-600">Укажите внутренний SIP-номер в Настройках → Личные настройки, чтобы звонить.</p>
        )}

        {/* История звонков (очередь — сворачиваемая с audio/score; /clients — простой список) */}
        {fullDispositionFlow ? (
          callHistory.length > 0 && (
            <div className="border-t pt-3">
              <button onClick={() => setShowHistory((v) => !v)} className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground">
                <span>История звонков ({callHistory.length})</span>
                <span>{showHistory ? '▾' : '▸'}</span>
              </button>
              <div className={`space-y-2.5 mt-2 ${showHistory ? '' : 'hidden'}`}>
                {callHistory.map((h) => (
                  <div key={h.id} className="border-b border-gray-100 last:border-0 pb-2.5 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className={h.status === 'reached' ? 'text-green-600 font-medium' : h.status === 'declined' ? 'text-red-600 font-medium' : 'text-muted-foreground font-medium'}>
                        {STATUS_LABELS[h.sub_status ?? ''] ?? STATUS_LABELS[h.status] ?? h.status}
                        {h.reason && <span className="text-muted-foreground"> — {h.reason}</span>}
                      </span>
                      <span className="text-muted-foreground text-[10px]">{formatTime(h.created_at)}</span>
                    </div>
                    {h.notes && <div className="text-muted-foreground text-[11px] bg-gray-50/50 p-1.5 rounded italic">“{h.notes}”</div>}
                    {h.call_score && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded font-bold border border-blue-100">
                          Оценка: {h.call_score}/10
                        </span>
                        {h.summary && (
                          <span className="text-muted-foreground text-[10px] truncate max-w-[180px]" title={h.summary}>{h.summary}</span>
                        )}
                      </div>
                    )}
                    {h.audio_url && (
                      <div className="mt-1">
                        <audio src={h.audio_url} controls className="w-full h-6 rounded-md bg-gray-50 text-xs" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          callHistory.length > 0 && (
            <div className="border-t pt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-2">История звонков ({callHistory.length})</div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {callHistory.map((h) => (
                  <div key={h.id} className="text-[11px] border-b pb-1">
                    <div className="flex justify-between text-[#8a877e]">
                      <span>{formatTime(h.created_at)}</span>
                      <span className="font-medium text-foreground">{h.manager_name}</span>
                    </div>
                    <div className="font-semibold mt-0.5">
                      {STATUS_LABELS[h.sub_status ?? ''] || STATUS_LABELS[h.status] || h.status}
                      {h.reason && <span className="font-normal text-muted-foreground"> ({h.reason})</span>}
                    </div>
                    {h.notes && <div className="text-muted-foreground italic mt-0.5">«{h.notes}»</div>}
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {/* Записи звонков VPBX + AI-оценка (только очередь) */}
        {vpbxCalls !== undefined && onRefreshVpbx && (
          <div className="border-t pt-3">
            <button onClick={() => setShowRecord((v) => !v)} className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground mb-2">
              <span>Записи и транскрипт ({vpbxCalls.length})</span>
              <span>{showRecord ? '▾' : '▸'}</span>
            </button>
            <div className={showRecord ? '' : 'hidden'}>
              <VpbxCallsPanel calls={vpbxCalls} onRefresh={onRefreshVpbx} />
            </div>
          </div>
        )}

        {/* ─── Диспетчер результатов звонка ─── */}
        <div className={fullDispositionFlow ? 'mt-1 rounded-lg border bg-muted/40 p-3' : 'rounded-lg border bg-muted/40 p-3'}>
          {/* Level 1 */}
          {callPhase === 'level1' && (
            fullDispositionFlow ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-green-700">Дозвонился:</div>
                  <Button size="sm" className="w-full bg-green-600 hover:bg-green-700" onClick={handleOrder} disabled={disposing}><KbdHint k="1" />Оформить заказ</Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setCallPhase('callback_schedule')} disabled={disposing}><KbdHint k="2" />Перезвонить позже</Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setCallPhase('decline_reason')} disabled={disposing}><KbdHint k="3" />Отказ (с причиной)</Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={handleWhatsApp} disabled={disposing}><KbdHint k="4" />Отправить WhatsApp</Button>
                  <Button size="sm" variant="outline" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50/50" onClick={handleWrongNumber} disabled={disposing}>Неверный номер</Button>
                </div>
                <div className="space-y-2 border-t pt-3">
                  <div className="text-xs font-semibold text-red-700">Не дозвонился:</div>
                  <Button size="sm" variant="outline" className="w-full" onClick={handleUnavailableFull} disabled={disposing}><KbdHint k="0" />Недоступен (перезвон через 4ч)</Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={handleBlockedFull} disabled={disposing}>Сбросил / заблокировал</Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={handleNotReachedWhatsApp} disabled={disposing}>Отправить WhatsApp</Button>
                </div>
                {showNextClient && (
                  <div className="border-t pt-2 relative">
                    <Button size="sm" variant="ghost" className="w-full text-xs text-muted-foreground" onClick={() => setShowSnoozeMenu((v) => !v)} disabled={disposing}>
                      Пропустить {showSnoozeMenu ? '▾' : '▸'}
                    </Button>
                    {showSnoozeMenu && (
                      <div className="mt-1 space-y-1 rounded-md border bg-white p-1 shadow-sm">
                        <Button size="sm" variant="ghost" className="w-full justify-start text-xs" onClick={() => handleSnooze('30m')} disabled={disposing}>Через 30 мин</Button>
                        <Button size="sm" variant="ghost" className="w-full justify-start text-xs" onClick={() => handleSnooze('2h')} disabled={disposing}>Через 2 часа</Button>
                        <Button size="sm" variant="ghost" className="w-full justify-start text-xs" onClick={() => handleSnooze('tomorrow')} disabled={disposing}>Завтра (09:00)</Button>
                        <Button size="sm" variant="ghost" className="w-full justify-start text-xs text-muted-foreground" onClick={onClose} disabled={disposing}>Просто закрыть</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground font-medium">Результат звонка:</div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => setCallPhase('reached_actions')}>Дозвонился</Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => setCallPhase('not_reached_actions')}>Не дозвонился</Button>
                </div>
              </div>
            )
          )}

          {/* reached_actions (/clients) */}
          {callPhase === 'reached_actions' && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-green-700">Дозвонился:</div>
              <Button size="sm" className="w-full bg-green-600 hover:bg-green-700" onClick={() => submitSimple('reached', 'ordered')} disabled={disposing}>Оформил заказ</Button>
              <Button size="sm" variant="outline" className="w-full" onClick={() => setCallPhase('callback_schedule')} disabled={disposing}>Перезвонить позже</Button>
              <Button size="sm" variant="outline" className="w-full" onClick={() => setCallPhase('decline_reason')} disabled={disposing}>Отказ от услуг</Button>
              <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setCallPhase('level1')}>← Назад</Button>
            </div>
          )}

          {/* not_reached_actions (/clients) */}
          {callPhase === 'not_reached_actions' && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-red-700">Не дозвонился:</div>
              <Button size="sm" variant="outline" className="w-full" onClick={() => submitSimple('not_reached', 'unavailable')} disabled={disposing}>Недоступен (перезвон)</Button>
              <Button size="sm" variant="outline" className="w-full" onClick={() => submitSimple('not_reached', 'blocked')} disabled={disposing}>Сбросил / заблокировал</Button>
              <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setCallPhase('level1')}>← Назад</Button>
            </div>
          )}

          {/* decline_reason (shared) */}
          {callPhase === 'decline_reason' && (
            <div className="space-y-3">
              <div className="text-xs font-semibold">Причина отказа:</div>
              <div className="space-y-1">
                {DECLINE_REASONS.map((r) => (
                  <label key={r.value} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" name="decline" value={r.value} checked={declineReason === r.value}
                      onChange={(e) => setDeclineReason(e.target.value)} className="accent-primary" />
                    {r.label}
                  </label>
                ))}
              </div>
              {declineReason === 'decline_other' && (
                <Input placeholder={fullDispositionFlow ? 'Причина...' : 'Своя причина...'} value={declineText} onChange={(e) => setDeclineText(e.target.value)} className="h-8 text-xs" />
              )}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleSubmitDecline} disabled={!declineReason || disposing}>Сохранить</Button>
                <Button size="sm" variant="ghost" onClick={() => { setCallPhase(fullDispositionFlow ? 'level1' : 'reached_actions'); setDeclineReason('') }}>← Назад</Button>
              </div>
            </div>
          )}

          {/* callback_schedule (shared) */}
          {callPhase === 'callback_schedule' && (
            <div className="space-y-3">
              <div className="text-xs font-semibold">{fullDispositionFlow ? 'Когда перезвонить?' : 'Назначить перезвон:'}</div>
              <div className="flex flex-wrap gap-1.5">
                {CALLBACK_PRESETS.map((p) => (
                  <button key={p.label} type="button" onClick={() => applyCallbackPreset(p.build)}
                    className="rounded-md border border-[#ebe9e4] bg-[#fcfcfb] px-2 py-1 text-[11px] text-[#5c5950] hover:bg-muted/40">
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input type="date" value={cbDate} onChange={(e) => setCbDate(e.target.value)} className="flex-1 h-8 text-xs" />
                <Input type="time" value={cbTime} onChange={(e) => setCbTime(e.target.value)} className="w-24 h-8 text-xs" />
              </div>
              <Input placeholder={fullDispositionFlow ? 'Заметка (необязательно)' : 'Заметка...'} value={cbNotes} onChange={(e) => setCbNotes(e.target.value)} className="h-8 text-xs" />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleSubmitCallback} disabled={!cbDate || disposing}>Запланировать</Button>
                <Button size="sm" variant="ghost" onClick={() => setCallPhase(fullDispositionFlow ? 'level1' : 'reached_actions')}>← Назад</Button>
              </div>
            </div>
          )}

          {/* order (очередь) */}
          {callPhase === 'order' && (
            <OrderForm
              clientId={client.id} clientName={client.name}
              totalOrders={client.total_orders}
              onDone={onDispositionDone} onCancel={onClose}
            />
          )}

          {/* whatsapp (очередь) */}
          {callPhase === 'whatsapp' && (
            <WhatsAppPanel clientId={client.id} onDone={onDispositionDone} onCancel={onClose} />
          )}
        </div>

        {/* Контекст клиента (футер, очередь) */}
        {showFooterContext && (
          <div className="border-t pt-3 space-y-2">
            {client.address && (
              <div className="text-xs">
                <span className="text-muted-foreground">Адрес: </span>
                <span>{client.address}</span>
              </div>
            )}
            {client.last_order_date && (
              <div className="text-xs">
                <span className="text-muted-foreground">Посл. заказ: </span>
                <span>{formatDate(client.last_order_date)}</span>
              </div>
            )}
            {callHistory.some((h) => h.sub_status === 'sent_whatsapp') && (
              <Badge variant="outline" className="bg-green-50 text-green-700 text-[10px]">WhatsApp уже отправлен</Badge>
            )}
            {discounts && (
              <div className="text-xs">
                <span className="text-muted-foreground">Скидка: </span>
                <span className="font-medium">{discounts[SEGMENT_DISCOUNT_KEY[client.rfm_segment] ?? 'new']}%</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Модалка Wazzup чата */}
      <WazzupChatModal
        isOpen={showWazzupModal}
        onClose={() => setShowWazzupModal(false)}
        clientPhone={client.phone}
        clientName={client.name}
        clientId={client.id}
        totalOrders={client.total_orders}
      />
    </div>
  )
}
