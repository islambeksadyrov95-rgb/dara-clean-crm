'use client'

import { useMemo, useState } from 'react'
import { X, Plus, Search, SlidersHorizontal, Bookmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilterValueEditor } from './filter-value-editor'
import { summarizeCondition } from '@/lib/filters/summary'
import { DEFAULT_OP } from '@/lib/filters/types'
import type { FilterCondition, FilterFieldDef, FilterFieldOption } from '@/lib/filters/types'

// Универсальная панель фильтров: «+ Фильтр» → поле → значение → чип.
// Условия комбинируются по AND, одно условие на поле. Состояние — у страницы
// (conditions + onChange), сериализацию в URL делает страница через lib/filters/url.

export type SavedFilterItem = { id: string; name: string; conditions: FilterCondition[] }

interface FilterBarProps {
  fields: FilterFieldDef[]
  conditions: FilterCondition[]
  onChange: (conditions: FilterCondition[]) => void
  // Сохранённые фильтры (общие на команду) — опционально, страница даёт данные и колбэки.
  savedFilters?: SavedFilterItem[]
  onSaveCurrent?: (name: string) => Promise<boolean>
  onDeleteSaved?: (id: string) => void
  // Создание новой опции (теги): возвращает добавленную опцию или null.
  onCreateOption?: (fieldKey: string, label: string) => Promise<FilterFieldOption | null>
}

// index === null — добавление нового условия; число — редактирование существующего по позиции.
// Модель «по позиции» (а не «по полю») позволяет стакать сколько угодно условий,
// включая повторы одного поля (две услуги, два диапазона суммы и т.п.).
type EditorState = { index: number | null; field: FilterFieldDef; draft: FilterCondition['value'] }

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

export function FilterBar({
  fields, conditions, onChange, savedFilters, onSaveCurrent, onDeleteSaved, onCreateOption,
}: FilterBarProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [fieldSearch, setFieldSearch] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [savedOpen, setSavedOpen] = useState(false)
  const [saveName, setSaveName] = useState<string | null>(null)
  const [savingFilter, setSavingFilter] = useState(false)

  const byKey = new Map(fields.map((f) => [f.key, f]))

  // Все поля доступны всегда (повторы разрешены), фильтруются поиском и группируются.
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

  const closeAddMenu = () => { setAddOpen(false); setFieldSearch('') }

  // Новое условие — всегда добавляется (index null), даже если поле уже использовано.
  const addField = (field: FilterFieldDef) => {
    setEditor({ index: null, field, draft: emptyDraft(field) })
    closeAddMenu()
  }

  // Редактирование существующего условия по его позиции в списке.
  const editAt = (index: number) => {
    const c = conditions[index]
    const field = byKey.get(c.field)
    if (field) setEditor({ index, field, draft: c.value })
  }

  const applyEditor = () => {
    if (!editor || isEmptyValue(editor.draft)) return
    const next: FilterCondition = {
      field: editor.field.key,
      op: DEFAULT_OP[editor.field.kind],
      value: editor.draft,
    }
    const updated =
      editor.index === null
        ? [...conditions, next]
        : conditions.map((c, i) => (i === editor.index ? next : c))
    onChange(updated)
    setEditor(null)
  }

  const removeAt = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index))
    if (editor?.index === index) setEditor(null)
  }

  const editorCreate =
    editor && editor.field.creatable && onCreateOption
      ? (label: string) => onCreateOption(editor.field.key, label)
      : undefined

  return (
    <div className="space-y-2 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Кнопка + меню выбора поля */}
        <div className="relative">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => { setAddOpen((v) => !v); setEditor(null) }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            + Фильтр
          </Button>
          {addOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={closeAddMenu} />
              <div className="absolute left-0 top-9 z-40 w-72 rounded-xl border border-[#ebe9e4] bg-white shadow-xl overflow-hidden">
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
                <div className="max-h-80 overflow-y-auto p-1">
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
                          onClick={() => addField(f)}
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
            </>
          )}
        </div>

        {/* Активные условия — чипы. key по индексу: повторы одного поля допустимы. */}
        {conditions.map((c, index) => {
          const field = byKey.get(c.field)
          if (!field) return null
          const isEditing = editor?.index === index
          return (
            <span
              key={index}
              className={`inline-flex items-center gap-1.5 pl-3 pr-1 py-1 text-xs rounded-full border transition-colors ${
                isEditing
                  ? 'border-blue-300 bg-blue-100 text-blue-900 ring-1 ring-blue-200'
                  : 'border-blue-100 bg-blue-50/70 text-blue-900 hover:bg-blue-100/70'
              }`}
            >
              <button type="button" onClick={() => editAt(index)} className="flex items-center gap-1">
                <span className="font-semibold">{field.label}:</span>
                <span className="max-w-[14rem] truncate">{summarizeCondition(field, c)}</span>
              </button>
              <button
                type="button"
                aria-label={`Убрать фильтр ${field.label}`}
                onClick={() => removeAt(index)}
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

      {/* Редактор значения выбранного поля */}
      {editor && (
        <div className="rounded-xl border border-[#ebe9e4] bg-white p-3 max-w-md shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">{editor.field.label}</span>
            <button
              type="button"
              aria-label="Закрыть редактор"
              onClick={() => setEditor(null)}
              className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <FilterValueEditor
            field={editor.field}
            draft={editor.draft}
            onDraftChange={(draft) => setEditor({ ...editor, draft })}
            onCreateOption={editorCreate}
          />
          <div className="flex gap-2 pt-1 border-t border-[#f3f2ee]">
            <Button size="sm" className="mt-2" onClick={applyEditor}>Применить</Button>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditor(null)}>Отмена</Button>
          </div>
        </div>
      )}
    </div>
  )
}
