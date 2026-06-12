'use client'

import { useMemo, useState } from 'react'
import { X, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilterValueEditor } from './filter-value-editor'
import { DEFAULT_OP } from '@/lib/filters/types'
import type { FilterCondition, FilterFieldDef, FilterFieldOption } from '@/lib/filters/types'

// Панель фильтров в стиле amoCRM/Bitrix: одна форма со стеком полей, которые
// видно и заполняешь одновременно, + «Добавить поле» и единый «Применить».
// Черновик локальный (фетч не дёргается на каждый ввод), коммит — на «Применить».

interface FilterPanelProps {
  fields: FilterFieldDef[]
  value: FilterCondition[]
  onApply: (conditions: FilterCondition[]) => void
  onClose: () => void
  onCreateOption?: (fieldKey: string, label: string) => Promise<FilterFieldOption | null>
}

function emptyDraft(field: FilterFieldDef): FilterCondition['value'] {
  if (field.kind === 'text') return ''
  if (field.kind === 'multiselect') return []
  return {}
}

function isEmptyValue(value: FilterCondition['value']): boolean {
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return !value.preset && !value.from && !value.to
}

export function FilterPanel({ fields, value, onApply, onClose, onCreateOption }: FilterPanelProps) {
  const [rows, setRows] = useState<FilterCondition[]>(value)
  const [pickerOpen, setPickerOpen] = useState(value.length === 0)
  const [fieldSearch, setFieldSearch] = useState('')

  const byKey = new Map(fields.map((f) => [f.key, f]))

  const groupedFields = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase()
    const available = q ? fields.filter((f) => f.label.toLowerCase().includes(q)) : fields
    const groups = new Map<string, FilterFieldDef[]>()
    for (const f of available) {
      const g = f.group ?? ''
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g)!.push(f)
    }
    return [...groups.entries()]
  }, [fields, fieldSearch])

  const addRow = (field: FilterFieldDef) => {
    setRows((prev) => [...prev, { field: field.key, op: DEFAULT_OP[field.kind], value: emptyDraft(field) }])
    setPickerOpen(false)
    setFieldSearch('')
  }

  const updateRow = (index: number, val: FilterCondition['value']) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, value: val } : r)))
  }

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  const apply = () => {
    onApply(rows.filter((r) => !isEmptyValue(r.value)))
    onClose()
  }

  const reset = () => {
    setRows([])
    onApply([])
  }

  return (
    <>
      {/* Клик вне панели — закрыть без применения (черновик отбрасывается). */}
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute left-0 top-9 z-40 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-[#ebe9e4] bg-white shadow-xl flex flex-col max-h-[min(36rem,calc(100vh-8rem))]">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#f3f2ee]">
          <span className="text-sm font-semibold">Фильтр</span>
          <button
            type="button"
            aria-label="Закрыть фильтр"
            onClick={onClose}
            className="h-6 w-6 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Стек полей — все видны и редактируются одновременно */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {rows.length === 0 && !pickerOpen && (
            <p className="text-xs text-muted-foreground text-center py-4">Добавьте поля для фильтрации</p>
          )}

          {rows.map((row, index) => {
            const field = byKey.get(row.field)
            if (!field) return null
            return (
              <div key={index} className="rounded-lg border border-[#f0eee9] bg-[#fcfcfb] p-2.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground">{field.label}</span>
                  <button
                    type="button"
                    aria-label={`Убрать поле ${field.label}`}
                    onClick={() => removeRow(index)}
                    className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <FilterValueEditor
                  field={field}
                  draft={row.value}
                  onDraftChange={(v) => updateRow(index, v)}
                  onCreateOption={
                    field.creatable && onCreateOption ? (label) => onCreateOption(field.key, label) : undefined
                  }
                />
              </div>
            )
          })}

          {/* Добавление поля */}
          {pickerOpen ? (
            <div className="rounded-lg border border-[#ebe9e4] overflow-hidden">
              <div className="relative border-b border-[#f3f2ee] p-2">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Поиск поля..."
                  className="h-8 text-sm pl-7 border-0 shadow-none focus-visible:ring-0"
                  value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="max-h-56 overflow-y-auto p-1">
                {groupedFields.length === 0 && (
                  <div className="px-3 py-4 text-xs text-muted-foreground text-center">Поля не найдены</div>
                )}
                {groupedFields.map(([group, groupFields]) => (
                  <div key={group || 'default'} className="mb-1 last:mb-0">
                    {group && (
                      <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group}
                      </div>
                    )}
                    {groupFields.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => addRow(f)}
                        className="flex w-full items-center gap-2 text-left px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                        {f.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5 border-dashed"
              onClick={() => setPickerOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить поле
            </Button>
          )}
        </div>

        {/* Футер: применить / сбросить */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-[#f3f2ee]">
          <Button size="sm" onClick={apply}>Применить</Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={reset}>
            Сбросить
          </Button>
        </div>
      </div>
    </>
  )
}
