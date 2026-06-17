'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

// Порог, выше которого массовое действие требует подтверждения (window.confirm).
const CONFIRM_THRESHOLD = 50

// Спец-значение тега «создать новый» в выпадашке тегов.
const CREATE_TAG_VALUE = '__create__'
// Спец-значение сегмента «авто по правилам» (сброс ручного override).
export const SEGMENT_AUTO_VALUE = '__auto__'

export type BulkTag = { id: string; name: string }
export type SegmentOption = { value: string; label: string }

// ─── Передача предвыбранных клиентов на /broadcasts (без нового бэкенда отправки) ───
// Кладём id в sessionStorage: переживает навигацию, не светится в URL, без лимита длины.
const PRESELECT_KEY = 'broadcast-preselect-ids'

export function setBroadcastPreselect(ids: readonly string[]): void {
  try {
    sessionStorage.setItem(PRESELECT_KEY, JSON.stringify(ids))
  } catch {
    // sessionStorage недоступен (приватный режим) — тихо пропускаем.
  }
}

// Читает и СРАЗУ очищает (одноразовая передача) — возврат на /broadcasts не подставит повторно.
export function takeBroadcastPreselect(): string[] {
  try {
    const raw = sessionStorage.getItem(PRESELECT_KEY)
    if (!raw) return []
    sessionStorage.removeItem(PRESELECT_KEY)
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

type BulkActionBarProps = {
  selectedCount: number
  isAdmin: boolean
  busy: boolean
  onClear: () => void
  // Менеджерские операции (видны всем).
  tags: BulkTag[]
  onAddTag: (input: { tagId?: string; name?: string }) => void | Promise<void>
  onBroadcast: () => void
  // «Выбрать всю выборку» (опционально — есть только на /clients).
  total?: number
  selectingAll?: boolean
  onSelectAll?: () => void
  // Админские операции (рендерятся только при isAdmin).
  managers?: ReadonlyMap<string, string>
  onAssignManager?: (managerId: string | null) => void | Promise<void>
  segmentOptions?: SegmentOption[]
  onAssignSegment?: (segment: string | null) => void | Promise<void>
}

// Подтверждение для крупной выборки: возвращает true, если можно продолжать.
function confirmLarge(count: number, actionLabel: string): boolean {
  if (count < CONFIRM_THRESHOLD) return true
  return window.confirm(`${actionLabel} для ${count} клиентов. Продолжить?`)
}

export function BulkActionBar(props: BulkActionBarProps) {
  const { selectedCount, isAdmin, busy, onClear } = props
  // Локальный стейт выбора тега + ввода нового имени (Apply — отдельной кнопкой).
  const [tagValue, setTagValue] = useState('')
  const [newTagName, setNewTagName] = useState('')

  if (selectedCount === 0) return null

  const handleApplyTag = async () => {
    if (!tagValue) return
    const isCreate = tagValue === CREATE_TAG_VALUE
    const name = newTagName.trim()
    if (isCreate && !name) return
    if (!confirmLarge(selectedCount, 'Добавить тег')) return
    await props.onAddTag(isCreate ? { name } : { tagId: tagValue })
    setTagValue('')
    setNewTagName('')
  }

  const tagLabel =
    tagValue === CREATE_TAG_VALUE
      ? 'Новый тег…'
      : props.tags.find((t) => t.id === tagValue)?.name ?? 'Добавить тег…'

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-wrap items-center gap-3 p-3 px-6 rounded-2xl border border-blue-100 bg-white/95 backdrop-blur-md shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      <span className="font-semibold text-blue-800 text-sm whitespace-nowrap">
        Выбрано: {selectedCount}
      </span>

      {props.onSelectAll && props.total != null && selectedCount < props.total && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs whitespace-nowrap"
          disabled={busy || props.selectingAll}
          onClick={props.onSelectAll}
        >
          {props.selectingAll ? 'Выбор…' : `Выбрать всю выборку (${props.total})`}
        </Button>
      )}

      {/* ─── Теги (доступно менеджеру) ─── */}
      <div className="flex items-center gap-1.5">
        <Select value={tagValue} onValueChange={(v) => setTagValue(v ?? '')} disabled={busy}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="Добавить тег…">{tagLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CREATE_TAG_VALUE}>+ Создать тег…</SelectItem>
            {props.tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tagValue === CREATE_TAG_VALUE && (
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            placeholder="Имя тега"
            maxLength={40}
            className="h-8 w-[120px] rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
          />
        )}
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={busy || !tagValue || (tagValue === CREATE_TAG_VALUE && !newTagName.trim())}
          onClick={handleApplyTag}
        >
          Применить
        </Button>
      </div>

      {/* ─── Рассылка (доступно менеджеру) ─── */}
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs"
        disabled={busy}
        onClick={props.onBroadcast}
      >
        В рассылку
      </Button>

      {/* ─── Админские операции ─── */}
      {isAdmin && props.onAssignManager && props.managers && (
        <select
          className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs cursor-pointer focus:outline-none disabled:opacity-50"
          value=""
          disabled={busy}
          onChange={async (e) => {
            const val = e.target.value
            if (!val) return
            e.target.value = ''
            if (!confirmLarge(selectedCount, 'Назначить менеджера')) return
            await props.onAssignManager?.(val === 'unassigned' ? null : val)
          }}
        >
          <option value="" disabled>Назначить менеджера…</option>
          <option value="unassigned">Общая очередь</option>
          {Array.from(props.managers.entries()).map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      )}

      {isAdmin && props.onAssignSegment && props.segmentOptions && (
        <select
          className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs cursor-pointer focus:outline-none disabled:opacity-50"
          value=""
          disabled={busy}
          onChange={async (e) => {
            const val = e.target.value
            if (!val) return
            e.target.value = ''
            if (!confirmLarge(selectedCount, 'Изменить сегмент')) return
            await props.onAssignSegment?.(val === SEGMENT_AUTO_VALUE ? null : val)
          }}
        >
          <option value="" disabled>Изменить сегмент…</option>
          {props.segmentOptions.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="h-8 text-xs text-muted-foreground hover:bg-muted/50"
        onClick={onClear}
        disabled={busy}
      >
        Сбросить
      </Button>
    </div>
  )
}
