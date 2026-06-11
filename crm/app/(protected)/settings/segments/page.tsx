'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getSegmentRules, updateSegmentRules } from '../actions'
import { DEFAULT_SEGMENT_RULES, type SegmentRule, type SegmentRuleType } from '@/lib/segments'

const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: 'Синий', value: 'bg-blue-50 text-blue-700 border-blue-100' },
  { label: 'Бирюзовый', value: 'bg-teal-50 text-teal-700 border-teal-100' },
  { label: 'Зелёный', value: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { label: 'Янтарный', value: 'bg-amber-50 text-amber-700 border-amber-100' },
  { label: 'Красный', value: 'bg-red-50 text-red-700 border-red-100' },
  { label: 'Фиолетовый', value: 'bg-violet-50 text-violet-700 border-violet-100' },
  { label: 'Серый', value: 'bg-gray-50 text-gray-700 border-gray-100' },
]

const RULE_TYPES: { value: SegmentRuleType; label: string }[] = [
  { value: 'days_gt', label: 'Дней без заказа больше чем' },
  { value: 'orders_gte', label: 'Заказов не меньше чем' },
  { value: 'default', label: 'Все остальные клиенты' },
]

function toRuleType(value: string): SegmentRuleType {
  const found = RULE_TYPES.find((t) => t.value === value)
  return found ? found.value : 'default'
}

export default function SegmentsSettingsPage() {
  const [segments, setSegments] = useState<SegmentRule[]>(DEFAULT_SEGMENT_RULES.segments)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSegmentRules()
      .then((cfg) => setSegments(cfg.segments))
      .catch(() => toast.error('Не удалось загрузить правила сегментации'))
      .finally(() => setLoading(false))
  }, [])

  const patchRow = (index: number, patch: Partial<SegmentRule>) =>
    setSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const moveRow = (index: number, dir: -1 | 1) =>
    setSegments((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const removeRow = (index: number) =>
    setSegments((prev) => prev.filter((_, i) => i !== index))

  const addRow = () =>
    setSegments((prev) => [
      ...prev,
      { name: 'Новый сегмент', color: COLOR_PRESETS[0].value, type: 'orders_gte', value: 1 },
    ])

  const save = async () => {
    setSaving(true)
    const res = await updateSegmentRules({ segments })
    if (res.success) toast.success('Правила сегментации сохранены')
    else toast.error(res.error)
    setSaving(false)
  }

  if (loading) return <div className="text-muted-foreground py-8 text-center">Загрузка...</div>

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Сегменты клиентов</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Правила применяются по порядку сверху вниз — клиент получает первый подходящий сегмент.
          «Все остальные» должен быть последним. Система пересчитывает сегмент автоматически;
          выставленный вручную в карточке клиента имеет приоритет.
        </p>
      </div>

      <div className="space-y-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
            <span className={`rounded border px-2 py-0.5 text-xs font-bold ${seg.color}`}>
              {seg.name || '—'}
            </span>
            <Input
              value={seg.name}
              onChange={(e) => patchRow(i, { name: e.target.value })}
              placeholder="Название"
              className="h-8 w-40 text-sm"
            />
            <select
              value={seg.type}
              onChange={(e) => patchRow(i, { type: toRuleType(e.target.value) })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {RULE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {seg.type !== 'default' && (
              <Input
                type="number"
                min={0}
                value={seg.value}
                onChange={(e) => patchRow(i, { value: Number(e.target.value) || 0 })}
                className="h-8 w-20 text-sm"
              />
            )}
            <select
              value={seg.color}
              onChange={(e) => patchRow(i, { color: e.target.value })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {COLOR_PRESETS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => moveRow(i, -1)} disabled={i === 0} className="p-1 disabled:opacity-30" title="Выше">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button onClick={() => moveRow(i, 1)} disabled={i === segments.length - 1} className="p-1 disabled:opacity-30" title="Ниже">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button onClick={() => removeRow(i)} className="p-1 text-red-600 hover:bg-red-50 rounded" title="Удалить">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus className="h-4 w-4 mr-1" /> Добавить сегмент
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>
    </div>
  )
}
