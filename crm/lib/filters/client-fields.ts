import type { FilterFieldDef } from './types'

// Реестр фильтруемых полей клиента — единственный источник правды для
// FilterBar (UI) и validateConditions (сервер). Новое поле = одна запись здесь
// + ветка маппинга в apply.ts. Ключи НЕ обязаны совпадать с колонками БД —
// маппинг в колонки живёт в apply.ts (например days_since_last_order → last_order_date).

/** Спец-значение фильтра по менеджеру: клиент без ответственного («Общая очередь»). */
export const MANAGER_NONE = '__none__'

export const CLIENT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'name', label: 'Имя', kind: 'text' },
  { key: 'phone', label: 'Телефон', kind: 'text' },
  { key: 'address', label: 'Адрес', kind: 'text' },
  { key: 'sticky_note', label: 'Заметка содержит', kind: 'text' },
  // options инжектятся страницей: менеджеры из getUsersDirectory, сегменты из segmentConfig
  { key: 'assigned_manager', label: 'Ответственный', kind: 'multiselect' },
  { key: 'rfm_segment', label: 'Сегмент', kind: 'multiselect' },
  { key: 'total_orders', label: 'Кол-во заказов', kind: 'number-range', unit: 'шт.' },
  { key: 'total_spent', label: 'Сумма заказов', kind: 'number-range', unit: '₸' },
  { key: 'avg_order_value', label: 'Средний чек', kind: 'number-range', unit: '₸' },
  { key: 'days_since_last_order', label: 'Дней без заказа', kind: 'number-range', unit: 'дн.' },
  { key: 'last_order_date', label: 'Последний заказ', kind: 'date-range' },
  { key: 'created_at', label: 'Добавлен в CRM', kind: 'date-range' },
  { key: 'days_since_last_call', label: 'Дней с последнего звонка', kind: 'number-range', unit: 'дн.' },
  {
    key: 'call_ever',
    label: 'Звонки',
    kind: 'multiselect',
    options: [
      { value: 'never', label: 'Никогда не звонили' },
      { value: 'has', label: 'Звонили хотя бы раз' },
    ],
  },
  {
    key: 'next_action',
    label: 'Следующий шаг',
    kind: 'multiselect',
    options: [
      { value: 'overdue', label: 'Просрочен' },
      { value: 'planned', label: 'Запланирован' },
      { value: 'none', label: 'Не назначен' },
    ],
  },
]

export const CLIENT_FILTER_FIELD_KEYS = new Set(CLIENT_FILTER_FIELDS.map((f) => f.key))
