'use client'

import { useState } from 'react'
import { X, SlidersHorizontal, Bookmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilterPanel } from './filter-panel'
import { summarizeCondition } from '@/lib/filters/summary'
import type { FilterCondition, FilterFieldDef, FilterFieldOption } from '@/lib/filters/types'

// Панель фильтров в стиле amoCRM/Bitrix: «+ Фильтр» открывает форму со стеком
// полей (см. FilterPanel), которые заполняются одновременно. Применённые условия
// показываются чипами-сводкой; клик по чипу или кнопке открывает ту же форму.

export type SavedFilterItem = { id: string; name: string; conditions: FilterCondition[] }

interface FilterBarProps {
  fields: FilterFieldDef[]
  conditions: FilterCondition[]
  onChange: (conditions: FilterCondition[]) => void
  savedFilters?: SavedFilterItem[]
  onSaveCurrent?: (name: string) => Promise<boolean>
  onDeleteSaved?: (id: string) => void
  onCreateOption?: (fieldKey: string, label: string) => Promise<FilterFieldOption | null>
}

export function FilterBar({
  fields, conditions, onChange, savedFilters, onSaveCurrent, onDeleteSaved, onCreateOption,
}: FilterBarProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [saveName, setSaveName] = useState<string | null>(null)
  const [savingFilter, setSavingFilter] = useState(false)

  const byKey = new Map(fields.map((f) => [f.key, f]))

  return (
    <div className="space-y-2 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Кнопка + форма фильтра */}
        <div className="relative">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPanelOpen((v) => !v)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            + Фильтр
          </Button>
          {panelOpen && (
            <FilterPanel
              fields={fields}
              value={conditions}
              onApply={onChange}
              onClose={() => setPanelOpen(false)}
              onCreateOption={onCreateOption}
            />
          )}
        </div>

        {/* Применённые условия — чипы-сводка (клик открывает форму) */}
        {conditions.map((c, index) => {
          const field = byKey.get(c.field)
          if (!field) return null
          return (
            <span
              key={index}
              className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 text-xs rounded-full border border-blue-100 bg-blue-50/70 text-blue-900 hover:bg-blue-100/70 transition-colors"
            >
              <button type="button" onClick={() => setPanelOpen(true)} className="flex items-center gap-1">
                <span className="font-semibold">{field.label}:</span>
                <span className="max-w-[14rem] truncate">{summarizeCondition(field, c)}</span>
              </button>
              <button
                type="button"
                aria-label={`Убрать фильтр ${field.label}`}
                onClick={() => onChange(conditions.filter((_, i) => i !== index))}
                className="h-4 w-4 flex items-center justify-center rounded-full hover:bg-blue-200 text-blue-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}

        {conditions.length > 0 && (
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => onChange([])}>
            Сбросить
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {savedFilters && savedFilters.length > 0 && (
            <div className="relative">
              <Button size="sm" variant="ghost" className="text-xs gap-1.5" onClick={() => setSavedOpen((v) => !v)}>
                <Bookmark className="h-3.5 w-3.5" />
                Сохранённые ({savedFilters.length})
              </Button>
              {savedOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setSavedOpen(false)} />
                  <div className="absolute right-0 top-9 z-40 w-72 max-h-72 overflow-y-auto rounded-xl border border-[#ebe9e4] bg-white shadow-xl p-1">
                    {savedFilters.map((sf) => (
                      <div key={sf.id} className="flex items-center gap-1 rounded-md hover:bg-muted">
                        <button
                          type="button"
                          onClick={() => { onChange(sf.conditions); setSavedOpen(false) }}
                          className="flex-1 flex items-center gap-2 text-left px-2 py-1.5 text-sm"
                        >
                          <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
                          {sf.name}
                        </button>
                        {onDeleteSaved && (
                          <button
                            type="button"
                            aria-label={`Удалить фильтр ${sf.name}`}
                            onClick={() => onDeleteSaved(sf.id)}
                            className="h-5 w-5 mr-1 flex items-center justify-center rounded-full hover:bg-red-50 text-muted-foreground hover:text-red-600"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {onSaveCurrent && conditions.length > 0 && saveName === null && (
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSaveName('')}>
              Сохранить фильтр
            </Button>
          )}
        </div>
      </div>

      {/* Сохранение текущего фильтра */}
      {saveName !== null && onSaveCurrent && (
        <div className="flex items-center gap-1.5 max-w-sm">
          <Input
            className="h-8 flex-1 text-sm"
            placeholder="Название фильтра..."
            value={saveName}
            disabled={savingFilter}
            autoFocus
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && saveName.trim()) {
                e.preventDefault()
                setSavingFilter(true)
                if (await onSaveCurrent(saveName)) setSaveName(null)
                setSavingFilter(false)
              }
            }}
          />
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={savingFilter || !saveName.trim()}
            onClick={async () => {
              setSavingFilter(true)
              if (await onSaveCurrent(saveName)) setSaveName(null)
              setSavingFilter(false)
            }}
          >
            Сохранить
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSaveName(null)}>
            Отмена
          </Button>
        </div>
      )}
    </div>
  )
}
