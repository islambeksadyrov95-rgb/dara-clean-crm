'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterValueEditor } from './filter-value-editor'
import { summarizeCondition } from '@/lib/filters/summary'
import { DEFAULT_OP } from '@/lib/filters/types'
import type { FilterCondition, FilterFieldDef } from '@/lib/filters/types'

// Универсальная панель фильтров: «+ Фильтр» → поле → значение → чип.
// Условия комбинируются по AND, одно условие на поле. Состояние — у страницы
// (conditions + onChange), сериализацию в URL делает страница через lib/filters/url.

interface FilterBarProps {
  fields: FilterFieldDef[]
  conditions: FilterCondition[]
  onChange: (conditions: FilterCondition[]) => void
}

type EditorState = { field: FilterFieldDef; draft: FilterCondition['value'] }

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

export function FilterBar({ fields, conditions, onChange }: FilterBarProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)

  const byKey = new Map(fields.map((f) => [f.key, f]))
  const usedKeys = new Set(conditions.map((c) => c.field))
  const availableFields = fields.filter((f) => !usedKeys.has(f.key))

  const openField = (field: FilterFieldDef) => {
    const existing = conditions.find((c) => c.field === field.key)
    setEditor({ field, draft: existing?.value ?? emptyDraft(field) })
    setAddOpen(false)
  }

  const applyEditor = () => {
    if (!editor || isEmptyValue(editor.draft)) return
    const next: FilterCondition = {
      field: editor.field.key,
      op: DEFAULT_OP[editor.field.kind],
      value: editor.draft,
    }
    const rest = conditions.filter((c) => c.field !== editor.field.key)
    onChange([...rest, next])
    setEditor(null)
  }

  const removeField = (key: string) => {
    onChange(conditions.filter((c) => c.field !== key))
    if (editor?.field.key === key) setEditor(null)
  }

  return (
    <div className="space-y-2 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Button size="sm" variant="outline" onClick={() => { setAddOpen((v) => !v); setEditor(null) }}>
            + Фильтр
          </Button>
          {addOpen && availableFields.length > 0 && (
            <div className="absolute left-0 top-9 z-40 w-64 max-h-72 overflow-y-auto rounded-lg border border-[#ebe9e4] bg-white shadow-lg p-1">
              {availableFields.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => openField(f)}
                  className="w-full text-left px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {conditions.map((c) => {
          const field = byKey.get(c.field)
          if (!field) return null
          return (
            <span
              key={c.field}
              className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 text-xs rounded-full border border-blue-100 bg-blue-50/60 text-blue-900"
            >
              <button type="button" onClick={() => openField(field)} className="hover:underline">
                <span className="font-semibold">{field.label}:</span> {summarizeCondition(field, c)}
              </button>
              <button
                type="button"
                aria-label={`Убрать фильтр ${field.label}`}
                onClick={() => removeField(c.field)}
                className="h-4 w-4 flex items-center justify-center rounded-full hover:bg-blue-100 text-blue-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}

        {conditions.length > 0 && (
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => onChange([])}>
            Сбросить фильтры
          </Button>
        )}
      </div>

      {editor && (
        <div className="rounded-lg border border-[#ebe9e4] bg-[#fcfcfb] p-3 max-w-xl space-y-3">
          <div className="text-xs font-semibold text-muted-foreground">{editor.field.label}</div>
          <FilterValueEditor
            field={editor.field}
            draft={editor.draft}
            onDraftChange={(draft) => setEditor({ ...editor, draft })}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={applyEditor}>Применить</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditor(null)}>Отмена</Button>
          </div>
        </div>
      )}
    </div>
  )
}
