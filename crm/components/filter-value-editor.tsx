'use client'

import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DATE_PRESETS, DATE_PRESET_LABELS } from '@/lib/filters/types'
import type { FilterCondition, FilterFieldDef, FilterFieldOption, RangeValue } from '@/lib/filters/types'

// Редактор значения одного условия — инпуты по kind поля.
// Контролируемый: черновик значения живёт в FilterBar, сюда приходит draft + onDraftChange.

interface FilterValueEditorProps {
  field: FilterFieldDef
  draft: FilterCondition['value']
  onDraftChange: (value: FilterCondition['value']) => void
  /** Создание новой опции (теги): возвращает добавленную опцию или null. */
  onCreateOption?: (label: string) => Promise<FilterFieldOption | null>
}

const SEARCHABLE_THRESHOLD = 8

function asRange(draft: FilterCondition['value']): RangeValue {
  return typeof draft === 'object' && !Array.isArray(draft) && draft !== null ? draft : {}
}

function MultiSelect({ field, draft, onDraftChange, onCreateOption }: FilterValueEditorProps) {
  const selected = Array.isArray(draft) ? draft : []
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const options = field.options ?? []
  const showSearch = options.length > SEARCHABLE_THRESHOLD || (field.creatable ?? false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, search])

  const toggle = (value: string) => {
    onDraftChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const exactMatch = options.some((o) => o.label.toLowerCase() === search.trim().toLowerCase())
  const canCreate = Boolean(field.creatable && onCreateOption && search.trim() && !exactMatch)

  const handleCreate = async () => {
    if (!onCreateOption) return
    setCreating(true)
    const option = await onCreateOption(search.trim())
    if (option) {
      onDraftChange([...selected, option.value])
      setSearch('')
    }
    setCreating(false)
  }

  return (
    <div className="space-y-2">
      {showSearch && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={field.creatable ? 'Поиск или новый тег...' : 'Поиск...'}
            className="h-8 text-sm pl-7"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) {
                e.preventDefault()
                handleCreate()
              }
            }}
            autoFocus
          />
        </div>
      )}

      <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
        {filtered.map((o) => {
          const isSelected = selected.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-left transition-colors ${
                isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted'
              }`}
            >
              <span
                className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center ${
                  isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-input bg-background'
                }`}
              >
                {isSelected && <Check className="h-3 w-3" />}
              </span>
              <span className="truncate">{o.label}</span>
            </button>
          )
        })}

        {filtered.length === 0 && !canCreate && (
          <div className="px-2 py-3 text-xs text-muted-foreground text-center">Ничего не найдено</div>
        )}
      </div>

      {canCreate && (
        <Button size="sm" variant="outline" className="h-7 text-xs w-full" disabled={creating} onClick={handleCreate}>
          {creating ? 'Создание...' : `Создать тег «${search.trim()}»`}
        </Button>
      )}

      {selected.length > 0 && (
        <div className="text-xs text-muted-foreground">Выбрано: {selected.length}</div>
      )}
    </div>
  )
}

function NumberRange({ field, draft, onDraftChange }: FilterValueEditorProps) {
  const range = asRange(draft)
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        placeholder="от"
        className="w-24 h-8 text-sm"
        value={range.from ?? ''}
        onChange={(e) => onDraftChange({ ...range, from: e.target.value })}
        autoFocus
      />
      <span className="text-muted-foreground text-sm">—</span>
      <Input
        type="number"
        placeholder="до"
        className="w-24 h-8 text-sm"
        value={range.to ?? ''}
        onChange={(e) => onDraftChange({ ...range, to: e.target.value })}
      />
      {field.unit && <span className="text-xs text-muted-foreground">{field.unit}</span>}
    </div>
  )
}

function DateRange({ draft, onDraftChange }: FilterValueEditorProps) {
  const range = asRange(draft)
  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {DATE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onDraftChange({ preset: p })}
            className={`px-2 py-1 text-xs rounded-md border transition-colors ${
              range.preset === p
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            }`}
          >
            {DATE_PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          className="w-36 h-8 text-sm"
          value={range.preset ? '' : range.from ?? ''}
          onChange={(e) => onDraftChange({ from: e.target.value, to: range.preset ? '' : range.to })}
        />
        <span className="text-muted-foreground text-sm">—</span>
        <Input
          type="date"
          className="w-36 h-8 text-sm"
          value={range.preset ? '' : range.to ?? ''}
          onChange={(e) => onDraftChange({ from: range.preset ? '' : range.from, to: e.target.value })}
        />
      </div>
    </div>
  )
}

export function FilterValueEditor(props: FilterValueEditorProps) {
  switch (props.field.kind) {
    case 'text':
      return (
        <Input
          placeholder="Содержит..."
          className="h-8 text-sm max-w-xs"
          value={typeof props.draft === 'string' ? props.draft : ''}
          onChange={(e) => props.onDraftChange(e.target.value)}
          autoFocus
        />
      )
    case 'multiselect':
      return <MultiSelect {...props} />
    case 'number-range':
      return <NumberRange {...props} />
    case 'date-range':
      return <DateRange {...props} />
  }
}
