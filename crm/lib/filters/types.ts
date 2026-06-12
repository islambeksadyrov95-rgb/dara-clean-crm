import { z } from 'zod'

// Модель условий фильтра — общая для FilterBar (UI), URL-сериализации и
// серверного билдера запросов. op хранится явно, хотя выводится из kind поля:
// модель должна пережить смену kind без поломки сохранённых ссылок.

export const DATE_PRESETS = ['today', 'last7', 'last30', 'last90', 'thisMonth', 'lastMonth'] as const
export type DatePreset = (typeof DATE_PRESETS)[number]

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Сегодня',
  last7: '7 дней',
  last30: '30 дней',
  last90: '90 дней',
  thisMonth: 'Этот месяц',
  lastMonth: 'Прошлый месяц',
}

export const rangeValueSchema = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  preset: z.enum(DATE_PRESETS).optional(),
})

export const conditionSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(['contains', 'in', 'between']),
  value: z.union([
    z.string().max(200),
    z.array(z.string().max(200)).max(50),
    rangeValueSchema,
  ]),
})

export const conditionsSchema = z.array(conditionSchema).max(20)

export type RangeValue = z.infer<typeof rangeValueSchema>
export type FilterCondition = z.infer<typeof conditionSchema>

export type FieldKind = 'text' | 'multiselect' | 'number-range' | 'date-range'

export interface FilterFieldOption {
  value: string
  label: string
}

export interface FilterFieldDef {
  key: string
  label: string
  kind: FieldKind
  /** Статичные опции multiselect; динамичные (менеджеры, сегменты) инжектит страница. */
  options?: FilterFieldOption[]
  /** Подпись единиц для number-range: «₸», «дн.», «шт.» */
  unit?: string
  /** multiselect: разрешить создание новой опции прямо в фильтре (теги). */
  creatable?: boolean
  /** Группа для меню выбора поля: «Клиент», «Заказы», «Звонки». */
  group?: string
}

export const DEFAULT_OP: Record<FieldKind, FilterCondition['op']> = {
  text: 'contains',
  multiselect: 'in',
  'number-range': 'between',
  'date-range': 'between',
}
