import type { FilterFieldDef } from './types'

// Реестр фильтруемых полей клиента — единственный источник правды для
// FilterBar (UI) и validateConditions (сервер). Новое поле = одна запись здесь
// + ветка маппинга в apply.ts. Ключи НЕ обязаны совпадать с колонками БД —
// маппинг в колонки живёт в apply.ts (например days_since_last_order → last_order_date).

/** Спец-значение фильтра по менеджеру: клиент без ответственного («Общая очередь»). */
export const MANAGER_NONE = '__none__'

const GROUP_CLIENT = 'Клиент'
const GROUP_ORDERS = 'Заказы и деньги'
const GROUP_CALLS = 'Звонки'
const GROUP_MARKETING = 'Маркетинг'

export const CLIENT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'name', label: 'Имя', kind: 'text', group: GROUP_CLIENT },
  { key: 'phone', label: 'Телефон', kind: 'text', group: GROUP_CLIENT },
  { key: 'address', label: 'Адрес', kind: 'text', group: GROUP_CLIENT },
  { key: 'sticky_note', label: 'Заметка содержит', kind: 'text', group: GROUP_CLIENT },
  // options инжектятся страницей: менеджеры из getUsersDirectory, сегменты из segmentConfig
  { key: 'assigned_manager', label: 'Ответственный', kind: 'multiselect', group: GROUP_CLIENT },
  { key: 'rfm_segment', label: 'Сегмент', kind: 'multiselect', group: GROUP_CLIENT },
  { key: 'tags', label: 'Теги', kind: 'multiselect', creatable: true, group: GROUP_CLIENT },
  { key: 'created_at', label: 'Добавлен в CRM', kind: 'date-range', group: GROUP_CLIENT },

  { key: 'total_orders', label: 'Кол-во заказов', kind: 'number-range', unit: 'шт.', group: GROUP_ORDERS },
  { key: 'total_spent', label: 'Сумма заказов', kind: 'number-range', unit: '₸', group: GROUP_ORDERS },
  { key: 'avg_order_value', label: 'Средний чек', kind: 'number-range', unit: '₸', group: GROUP_ORDERS },
  { key: 'days_since_last_order', label: 'Дней без заказа', kind: 'number-range', unit: 'дн.', group: GROUP_ORDERS },
  { key: 'last_order_date', label: 'Последний заказ', kind: 'date-range', group: GROUP_ORDERS },
  // options для order_service инжектятся страницей из getFilterDictionaries()
  { key: 'order_service', label: 'Услуга в заказах', kind: 'multiselect', group: GROUP_ORDERS },

  { key: 'days_since_last_call', label: 'Дней с последнего звонка', kind: 'number-range', unit: 'дн.', group: GROUP_CALLS },
  {
    key: 'call_ever',
    label: 'Звонки',
    kind: 'multiselect',
    group: GROUP_CALLS,
    options: [
      { value: 'never', label: 'Никогда не звонили' },
      { value: 'has', label: 'Звонили хотя бы раз' },
    ],
  },
  {
    key: 'next_action',
    label: 'Следующий шаг',
    kind: 'multiselect',
    group: GROUP_CALLS,
    options: [
      { value: 'overdue', label: 'Просрочен' },
      { value: 'planned', label: 'Запланирован' },
      { value: 'none', label: 'Не назначен' },
    ],
  },
  {
    key: 'decline_reason',
    label: 'Причина отказа',
    kind: 'multiselect',
    group: GROUP_CALLS,
    options: [
      { value: 'decline_expensive', label: 'Дорого' },
      { value: 'decline_competitor', label: 'Другая компания' },
      { value: 'decline_not_needed', label: 'Не нужно' },
      { value: 'decline_quality', label: 'Качество' },
      { value: 'decline_season', label: 'Не сезон' },
      { value: 'decline_other', label: 'Другое' },
    ],
  },
  { key: 'call_score', label: 'AI-оценка звонка', kind: 'number-range', unit: 'из 10', group: GROUP_CALLS },

  // options для acquisition_source инжектятся страницей из getFilterDictionaries()
  { key: 'acquisition_source', label: 'Источник', kind: 'multiselect', group: GROUP_MARKETING },
  {
    key: 'broadcast_no_order',
    label: 'Рассылка без заказа',
    kind: 'multiselect',
    group: GROUP_MARKETING,
    options: [
      { value: '30', label: 'За 30 дней' },
      { value: '60', label: 'За 60 дней' },
      { value: '90', label: 'За 90 дней' },
    ],
  },
]

export const CLIENT_FILTER_FIELD_KEYS = new Set(CLIENT_FILTER_FIELDS.map((f) => f.key))
