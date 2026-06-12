'use client'

import { Input } from '@/components/ui/input'
import { DATE_PRESETS, DATE_PRESET_LABELS } from '@/lib/filters/types'
import type { FilterCondition, FilterFieldDef, RangeValue } from '@/lib/filters/types'

// Редактор значения одного условия — инпуты по kind поля.
// Контролируемый: черновик значения живёт в FilterBar, сюда приходит draft + onDraftChange.

interface FilterValueEditorProps {
  field: FilterFieldDef
  draft: FilterCondition['value']
  onDraftChange: (value: FilterCondition['value']) => void
}

function asRange(draft: FilterCondition['value']): RangeValue {
  return typeof draft === 'object' && !Array.isArray(draft) && draft !== null ? draft : {}
}

function MultiSelect({ field, draft, onDraftChange }: FilterValueEditorProps) {
  const selected = Array.isArray(draft) ? draft : []
  const toggle = (value: string, checked: boolean) => {
    onDraftChange(checked ? [...selected, value] : selected.filter((v) => v !== value))
  }
  return (
    <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
      {(field.options ?? []).map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-gray-300 accent-primary h-4 w-4"
            checked={selected.includes(o.value)}
            onChange={(e) => toggle(o.value, e.target.checked)}
          />
          {o.label}
        </label>
      ))}
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
