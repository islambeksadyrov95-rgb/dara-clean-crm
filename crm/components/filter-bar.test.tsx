// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

afterEach(cleanup)
import { FilterBar } from './filter-bar'
import type { FilterFieldDef, FilterCondition, FilterFieldOption } from '@/lib/filters/types'

const FIELDS: FilterFieldDef[] = [
  { key: 'name', label: 'Имя', kind: 'text' },
  {
    key: 'rfm_segment',
    label: 'Сегмент',
    kind: 'multiselect',
    options: [
      { value: 'Потерянный', label: 'Потерянный' },
      { value: 'Новый', label: 'Новый' },
    ],
  },
  { key: 'total_orders', label: 'Кол-во заказов', kind: 'number-range', unit: 'шт.' },
]

// Контролируемая обёртка — отражает реальное использование (страница держит state).
function Harness({
  fields = FIELDS,
  initial = [],
  onCreateOption,
}: {
  fields?: FilterFieldDef[]
  initial?: FilterCondition[]
  onCreateOption?: (k: string, l: string) => Promise<FilterFieldOption | null>
}) {
  const [conditions, setConditions] = useState<FilterCondition[]>(initial)
  return (
    <FilterBar fields={fields} conditions={conditions} onChange={setConditions} onCreateOption={onCreateOption} />
  )
}

const addFilter = () => fireEvent.click(screen.getByRole('button', { name: /\+ Фильтр/ }))
const pickField = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }))
const done = () => fireEvent.click(screen.getByRole('button', { name: 'Готово' }))

describe('FilterBar (chip-first)', () => {
  it('adds a text condition: pick field -> type -> Готово -> chip', () => {
    render(<Harness />)
    addFilter()
    pickField('Имя')
    fireEvent.change(screen.getByPlaceholderText('Содержит...'), { target: { value: 'Айгуль' } })
    done()
    expect(screen.getByText('Айгуль')).toBeInTheDocument()
  })

  it('picking a field shows the chip immediately (before a value is set)', () => {
    render(<Harness />)
    addFilter()
    pickField('Имя')
    // Чип «Имя» появляется сразу с плейсхолдером, ещё до ввода значения.
    expect(screen.getByText('Имя:')).toBeInTheDocument()
    expect(screen.getByText('выберите')).toBeInTheDocument()
  })

  it('accumulates multiple different filters', () => {
    render(<Harness initial={[{ field: 'name', op: 'contains', value: 'А' }]} />)
    addFilter()
    pickField('Кол-во заказов')
    fireEvent.change(screen.getByPlaceholderText('от'), { target: { value: '2' } })
    done()
    // Оба чипа на месте.
    expect(screen.getByText('Имя:')).toBeInTheDocument()
    expect(screen.getByText('Кол-во заказов:')).toBeInTheDocument()
    expect(screen.getByText(/2 шт\./)).toBeInTheDocument()
  })

  it('keeps the first filter when switching to another field without Готово', () => {
    render(<Harness />)
    addFilter()
    pickField('Имя')
    fireEvent.change(screen.getByPlaceholderText('Содержит...'), { target: { value: 'Айгуль' } })
    // НЕ нажимаем Готово — сразу выбираем второе поле (как в репорте пользователя).
    addFilter()
    pickField('Кол-во заказов')
    // Первое условие не потерялось.
    expect(screen.getByText('Айгуль')).toBeInTheDocument()
    expect(screen.getByText('Кол-во заказов:')).toBeInTheDocument()
  })

  it('allows the same field more than once', () => {
    render(<Harness initial={[{ field: 'name', op: 'contains', value: 'А' }]} />)
    addFilter()
    pickField('Имя')
    fireEvent.change(screen.getByPlaceholderText('Содержит...'), { target: { value: 'Б' } })
    done()
    expect(screen.getByText('А')).toBeInTheDocument()
    expect(screen.getByText('Б')).toBeInTheDocument()
  })

  it('drops an abandoned empty condition on close', () => {
    render(<Harness />)
    addFilter()
    pickField('Имя')
    done() // закрыли без значения
    expect(screen.queryByText('Имя:')).not.toBeInTheDocument()
  })

  it('removes a condition via the chip X', () => {
    render(<Harness initial={[{ field: 'rfm_segment', op: 'in', value: ['Потерянный'] }]} />)
    expect(screen.getByText('Сегмент:')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Убрать фильтр Сегмент'))
    expect(screen.queryByText('Сегмент:')).not.toBeInTheDocument()
  })

  it('reset clears all conditions', () => {
    render(<Harness initial={[{ field: 'name', op: 'contains', value: 'А' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.queryByText('Имя:')).not.toBeInTheDocument()
  })

  it('creates a new tag option from the value editor', async () => {
    const onCreateOption = vi.fn().mockResolvedValue({ value: 't-new', label: 'VIP' })
    const fieldsWithTags: FilterFieldDef[] = [
      { key: 'tags', label: 'Теги', kind: 'multiselect', creatable: true, options: [] },
    ]
    render(<Harness fields={fieldsWithTags} onCreateOption={onCreateOption} />)
    addFilter()
    pickField('Теги')
    fireEvent.change(screen.getByPlaceholderText('Поиск или новый тег...'), { target: { value: 'VIP' } })
    fireEvent.click(screen.getByRole('button', { name: /Создать тег/ }))
    await waitFor(() => expect(onCreateOption).toHaveBeenCalledWith('tags', 'VIP'))
  })
})
