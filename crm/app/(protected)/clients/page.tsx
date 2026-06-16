'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import {
  createClient, getUsersDirectory, getClientCallHistoryWithNames, bulkAssignManager, bulkAssignSegment,
  getClientsList, getFilterDictionaries, getClientIdsByFilter,
  listSavedFilters, saveClientFilter, deleteSavedFilter,
  type FilterDictionaries, type SavedFilter,
} from './actions'
import { createTag } from './tag-actions'
import { getAttemptCount } from '../queue/actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { colorForSegment, segmentNames, computeSegment, DEFAULT_SEGMENT_RULES, type SegmentConfig } from '@/lib/segments'
import { getSegmentRules } from '../settings/actions'
import { getUserRole } from '@/lib/auth/get-user-role'
import { CallWorkPanel, type CallWorkClient, type CallWorkHistoryEntry } from '@/components/call-work-panel'
import { FilterBar } from '@/components/filter-bar'
import { CLIENT_FILTER_FIELDS, MANAGER_NONE } from '@/lib/filters/client-fields'
import { serializeConditions, parseConditions } from '@/lib/filters/url'
import type { FilterCondition } from '@/lib/filters/types'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20
const fmtMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

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
  assigned_manager_id: string | null
}

export default function ClientsPage() {
  const supabase = createSupabaseClient()

  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [segment, setSegment] = useState<string>('Все')
  const [segmentConfig, setSegmentConfig] = useState<SegmentConfig>(DEFAULT_SEGMENT_RULES)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  
  // Менеджеры
  const [managersMap, setManagersMap] = useState<Map<string, string>>(new Map())
  // Полная карта имён (вкл. админов) для колонки «Ответственный» + флаг загрузки.
  const [namesMap, setNamesMap] = useState<Map<string, string>>(new Map())
  const [namesLoaded, setNamesLoaded] = useState(false)
  
  // Роли и права
  const [isAdmin, setIsAdmin] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  
  const [bulkAssigning, setBulkAssigning] = useState(false)
  
  // Создание клиента
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientPhone, setNewClientPhone] = useState('')
  const [newClientAddress, setNewClientAddress] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)

  // Выбранный клиент (правая панель). Логика звонка/диспозиции — внутри CallWorkPanel.
  const [activeClient, setActiveClient] = useState<Client | null>(null)
  const [callHistory, setCallHistory] = useState<CallWorkHistoryEntry[]>([])
  const [attemptCount, setAttemptCount] = useState(0)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Условия FilterBar. Восстанавливаются из URL (?f=) на маунте,
  // каждое изменение пишется в URL — фильтр можно скинуть ссылкой, F5 не сбрасывает.
  const [conditions, setConditions] = useState<FilterCondition[]>([])
  const conditionsLoadedRef = useRef(false)

  useEffect(() => {
    setConditions(parseConditions(new URLSearchParams(window.location.search).get('f')))
    conditionsLoadedRef.current = true
  }, [])

  // Словари опций фильтров (теги, источники, услуги) + сохранённые фильтры.
  const [dictionaries, setDictionaries] = useState<FilterDictionaries>({ tags: [], sources: [], services: [] })
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [selectingAll, setSelectingAll] = useState(false)

  useEffect(() => {
    getFilterDictionaries().then(setDictionaries)
    listSavedFilters('clients').then(setSavedFilters)
  }, [])

  const handleSaveFilter = async (name: string): Promise<boolean> => {
    const res = await saveClientFilter('clients', name, conditions)
    if (!res.success) {
      toast.error(res.error)
      return false
    }
    toast.success('Фильтр сохранён')
    setSavedFilters(await listSavedFilters('clients'))
    return true
  }

  const handleDeleteFilter = async (id: string) => {
    const res = await deleteSavedFilter(id)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    setSavedFilters((prev) => prev.filter((f) => f.id !== id))
  }

  // Создание тега прямо из фильтра: создаём, обновляем словарь, возвращаем опцию.
  const handleCreateFilterOption = async (fieldKey: string, label: string) => {
    if (fieldKey !== 'tags') return null
    const res = await createTag(label)
    if (!res.success) {
      toast.error(res.error)
      return null
    }
    setDictionaries((prev) => ({
      ...prev,
      tags: prev.tags.some((t) => t.id === res.tag.id) ? prev.tags : [...prev.tags, res.tag],
    }))
    return { value: res.tag.id, label: res.tag.name }
  }

  // «Выбрать всю выборку»: ids всех клиентов под текущим фильтром (для массовых действий).
  const handleSelectAllFiltered = async () => {
    setSelectingAll(true)
    try {
      const res = await getClientIdsByFilter({ search: debouncedSearch, segment, conditions })
      if (res.success) {
        setSelectedIds(res.ids)
        toast.success(`Выбрано клиентов: ${res.ids.length}`)
      } else {
        toast.error(res.error)
      }
    } catch {
      toast.error('Не удалось выбрать клиентов — попробуйте ещё раз')
    } finally {
      setSelectingAll(false)
    }
  }

  const handleConditionsChange = (next: FilterCondition[]) => {
    setConditions(next)
    const params = new URLSearchParams(window.location.search)
    const serialized = serializeConditions(next)
    if (serialized) params.set('f', serialized)
    else params.delete('f')
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  // Поля фильтров с динамичными справочниками (менеджеры, сегменты).
  const filterFields = CLIENT_FILTER_FIELDS.map((f) => {
    if (f.key === 'assigned_manager') {
      return {
        ...f,
        options: [
          { value: MANAGER_NONE, label: 'Общая очередь' },
          ...Array.from(namesMap.entries()).map(([id, name]) => ({ value: id, label: name })),
        ],
      }
    }
    if (f.key === 'rfm_segment') {
      return { ...f, options: segmentNames(segmentConfig).map((s) => ({ value: s, label: s })) }
    }
    if (f.key === 'tags') {
      return { ...f, options: dictionaries.tags.map((t) => ({ value: t.id, label: t.name })) }
    }
    if (f.key === 'acquisition_source') {
      return {
        ...f,
        options: [
          { value: MANAGER_NONE, label: 'Не указан' },
          ...dictionaries.sources.map((s) => ({ value: s.id, label: s.name })),
        ],
      }
    }
    if (f.key === 'order_service') {
      return { ...f, options: dictionaries.services.map((s) => ({ value: s, label: s })) }
    }
    return f
  })

  // Получаем текущего пользователя и его роль
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setIsAdmin(getUserRole(user) === 'admin')
      }
    })
  }, [supabase])

  // Настроенные правила сегментации (названия, цвета) для фильтров и бейджей
  useEffect(() => {
    getSegmentRules()
      .then(setSegmentConfig)
      .catch((err) => console.warn('Не удалось загрузить правила сегментации, используются дефолтные:', err))
  }, [])

  // Менеджеры + имена всех пользователей одним server action (один listUsers вместо двух).
  useEffect(() => {
    async function loadUsers() {
      try {
        const { managers, allUsers } = await getUsersDirectory()
        setManagersMap(new Map(managers.map((u) => [u.id, u.name])))
        setNamesMap(new Map(allUsers.map((u) => [u.id, u.name])))
      } catch (err) {
        console.error('Failed to load users directory:', err)
      } finally {
        setNamesLoaded(true)
      }
    }
    loadUsers()
  }, [])

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  // Сброс выбора при изменении страницы или фильтров
  useEffect(() => {
    Promise.resolve().then(() => {
      setSelectedIds([])
      setPage(0)
    })
  }, [debouncedSearch, segment, conditions])

  useEffect(() => {
    Promise.resolve().then(() => {
      setSelectedIds([])
    })
  }, [page])

  const fetchClients = useCallback(async () => {
    setLoading(true)

    const res = await getClientsList({
      search: debouncedSearch,
      segment,
      page,
      pageSize: PAGE_SIZE,
      conditions,
    })

    if (res.success) {
      setClients(res.clients as Client[])
      setTotal(res.total)
    } else {
      toast.error(res.error || 'Ошибка при загрузке списка клиентов')
    }

    setLoading(false)
  }, [debouncedSearch, segment, page, conditions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchClients()
    })
  }, [fetchClients])

  const resetCallState = () => {
    setActiveClient(null)
    setCallHistory([])
    setAttemptCount(0)
  }

  const handleSelectClient = (client: Client) => {
    setActiveClient(client)
    getClientCallHistoryWithNames(client.id).then(setCallHistory)
    getAttemptCount(client.id).then(setAttemptCount)
  }

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newClientName.trim() || !newClientPhone.trim()) {
      toast.error('Заполните Имя и Телефон')
      return
    }

    setCreatingClient(true)
    try {
      const res = await createClient(newClientName, newClientPhone, newClientAddress)
      if (res.success) {
        toast.success('Клиент успешно создан')
        setShowCreateModal(false)
        setNewClientName('')
        setNewClientPhone('')
        setNewClientAddress('')
        fetchClients()
      } else {
        toast.error(res.error)
      }
    } catch {
      toast.error('Не удалось создать клиента — попробуйте ещё раз')
    } finally {
      setCreatingClient(false)
    }
  }

  // Ручная смена сегмента активного клиента (override === null → сброс на авто-расчёт).
  const handleSetClientSegment = async (override: string | null) => {
    if (!activeClient) return
    const res = await bulkAssignSegment([activeClient.id], override)
    if (!res.success) {
      toast.error(res.error)
      return
    }
    const newSeg = override ?? computeSegment(activeClient.total_orders, activeClient.days_since_last_order, segmentConfig)
    setActiveClient({ ...activeClient, rfm_segment: newSeg })
    toast.success('Сегмент обновлён')
    fetchClients()
  }

  // После сохранённой диспозиции: закрываем панель и обновляем список (сегмент/дни могли измениться).
  const handleDispositionDone = () => {
    resetCallState()
    fetchClients()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex gap-6">
      {/* Левая часть */}
      <div className={activeClient ? 'flex-1 min-w-0' : 'w-full'}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold">Клиенты</h1>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            + Создать клиента
          </Button>
        </div>

        {/* Фильтры */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <Input
            placeholder="Поиск по имени или телефону..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <div className="flex gap-1 flex-wrap">
            {['Все', ...segmentNames(segmentConfig)].map((s) => (
              <button
                key={s}
                onClick={() => setSegment(s)}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  segment === s
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:bg-muted'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Конструктор фильтров: любое поле клиента, условия комбинируются по AND */}
        <FilterBar
          fields={filterFields}
          conditions={conditions}
          onChange={handleConditionsChange}
          savedFilters={savedFilters}
          onSaveCurrent={handleSaveFilter}
          onDeleteSaved={handleDeleteFilter}
          onCreateOption={handleCreateFilterOption}
        />

        {/* Массовые действия (плавающая панель) */}
        {isAdmin && selectedIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 p-3 px-6 rounded-2xl border border-blue-100 bg-white/95 backdrop-blur-md shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
            <span className="font-semibold text-blue-800 text-sm whitespace-nowrap">Выбрано: {selectedIds.length}</span>
            {selectedIds.length < total && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs whitespace-nowrap"
                disabled={selectingAll}
                onClick={handleSelectAllFiltered}
              >
                {selectingAll ? 'Выбор...' : `Выбрать всю выборку (${total})`}
              </Button>
            )}

            <div className="flex items-center gap-2">
              <select
                className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs cursor-pointer focus:outline-none"
                defaultValue=""
                disabled={bulkAssigning}
                onChange={async (e) => {
                  const val = e.target.value
                  if (!val) return
                  setBulkAssigning(true)
                  const managerId = val === 'unassigned' ? null : val
                  try {
                    const res = await bulkAssignManager(selectedIds, managerId)
                    if (res.success) {
                      toast.success('Ответственный успешно назначен')
                      setSelectedIds([])
                      fetchClients()
                    } else {
                      toast.error(res.error)
                    }
                  } catch {
                    toast.error('Не удалось назначить ответственного — попробуйте ещё раз')
                  } finally {
                    setBulkAssigning(false)
                    e.target.value = ''
                  }
                }}
              >
                <option value="" disabled>Назначить менеджера...</option>
                <option value="unassigned">Общая очередь</option>
                {Array.from(managersMap.entries()).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>

              <select
                className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs cursor-pointer focus:outline-none"
                defaultValue=""
                disabled={bulkAssigning}
                onChange={async (e) => {
                  const val = e.target.value
                  if (!val) return
                  setBulkAssigning(true)
                  try {
                    // '__auto__' → сброс ручного сегмента на авто-расчёт по правилам.
                    const res = await bulkAssignSegment(selectedIds, val === '__auto__' ? null : val)
                    if (res.success) {
                      toast.success('Сегмент изменён')
                      setSelectedIds([])
                      fetchClients()
                    } else {
                      toast.error(res.error)
                    }
                  } catch {
                    toast.error('Не удалось изменить сегмент — попробуйте ещё раз')
                  } finally {
                    setBulkAssigning(false)
                    e.target.value = ''
                  }
                }}
              >
                <option value="" disabled>Изменить сегмент...</option>
                <option value="__auto__">Авто (по правилам)</option>
                {segmentNames(segmentConfig).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground hover:bg-muted/50"
              onClick={() => setSelectedIds([])}
              disabled={bulkAssigning}
            >
              Сбросить
            </Button>
          </div>
        )}

        {/* Таблица */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {isAdmin && (
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
                )}
                <TableHead>Имя</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Сегмент</TableHead>
                <TableHead>Ответственный</TableHead>
                <TableHead className="text-right">Заказов</TableHead>
                <TableHead className="text-right">Потрачено</TableHead>
                <TableHead>Последний заказ</TableHead>
                <TableHead className="text-right">Дней</TableHead>
                <TableHead className="text-right">Действие</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 10 : 9} className="text-center py-8 text-muted-foreground">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 10 : 9} className="text-center py-8 text-muted-foreground">
                    Клиенты не найдены
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((c) => (
                  <TableRow
                    key={c.id}
                    className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                      activeClient?.id === c.id 
                        ? 'bg-blue-50/50' 
                        : selectedIds.includes(c.id) 
                          ? 'bg-blue-50/20' 
                          : ''
                    }`}
                    onClick={() => handleSelectClient(c)}
                  >
                    {isAdmin && (
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
                    )}
                    <TableCell className="font-semibold text-foreground" onClick={(e) => e.stopPropagation()}>
                      <Link href={`/clients/${c.id}`} prefetch={false} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <a href={`tel:${c.phone}`} className="hover:underline text-muted-foreground" onClick={(e) => e.stopPropagation()}>{c.phone}</a>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={colorForSegment(c.rfm_segment, segmentConfig)}>
                        {c.rfm_segment}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-medium">
                      {c.assigned_manager_id
                        ? (namesMap.get(c.assigned_manager_id) || (namesLoaded ? '—' : 'Загрузка...'))
                        : 'Общая очередь'}
                    </TableCell>
                    <TableCell className="text-right">{c.total_orders}</TableCell>
                    <TableCell className="text-right">
                      {fmtMoney.format(c.total_spent)} ₸
                    </TableCell>
                    <TableCell>{formatDate(c.last_order_date)}</TableCell>
                    <TableCell className="text-right">
                      {c.days_since_last_order != null ? `${c.days_since_last_order} дн.` : '—'}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" render={<Link href={`/clients/${c.id}`} prefetch={false} />}>
                          Карточка
                        </Button>
                        <Button
                          size="sm"
                          variant={activeClient?.id === c.id ? 'default' : 'outline'}
                          onClick={() => handleSelectClient(c)}
                        >
                          Выбрать
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Пагинация */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-muted-foreground">
              {total} клиентов, стр. {page + 1} из {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-40 hover:bg-muted"
              >
                Назад
              </button>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-40 hover:bg-muted"
              >
                Вперёд
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Правая боковая панель: общий компонент работы со звонком */}
      {activeClient && (
        <CallWorkPanel
          key={activeClient.id}
          client={activeClient as CallWorkClient}
          callHistory={callHistory}
          attemptCount={attemptCount}
          onClose={resetCallState}
          onDispositionDone={handleDispositionDone}
          cardHref={`/clients/${activeClient.id}`}
          segmentColor={(seg) => colorForSegment(seg, segmentConfig)}
          segmentOptions={isAdmin ? segmentNames(segmentConfig).map((s) => ({ value: s, label: s })) : undefined}
          onSetSegment={isAdmin ? handleSetClientSegment : undefined}
        />
      )}

      {/* Модалка создания нового клиента */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white border border-[#ebe9e4] rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-4 py-3 border-b border-[#ebe9e4]/60 bg-[#fcfcfb] flex justify-between items-center">
              <h3 className="font-semibold text-sm">Создать нового клиента</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <form onSubmit={handleCreateClient} className="p-4 space-y-4">
              <div className="space-y-1">
                <label htmlFor="new-client-name" className="text-xs font-semibold text-muted-foreground">Имя клиента *</label>
                <Input
                  id="new-client-name"
                  required
                  placeholder="Например, Александр"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="new-client-phone" className="text-xs font-semibold text-muted-foreground">Телефон *</label>
                <Input
                  id="new-client-phone"
                  required
                  placeholder="Например, 87776217377"
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="new-client-address" className="text-xs font-semibold text-muted-foreground">Адрес (необязательно)</label>
                <Input
                  id="new-client-address"
                  placeholder="Улица, дом, квартира"
                  value={newClientAddress}
                  onChange={(e) => setNewClientAddress(e.target.value)}
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreateModal(false)}>
                  Отмена
                </Button>
                <Button type="submit" size="sm" disabled={creatingClient}>
                  {creatingClient ? 'Создание...' : 'Создать клиента'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
