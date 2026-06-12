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
  { key: 'address', label: 'Адрес', kind: 'text' },
  { key: 'total_orders', label: 'Кол-во заказов', kind: 'number-range', unit: 'шт.' },
  {
    key: 'rfm_segment',
    label: 'Сегмент',
    kind: 'multiselect',
    options: [{ value: 'Потерянный', label: 'Потерянный' }],
  },
]

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

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /\+ Фильтр/ }))
const addFieldBtn = () => fireEvent.click(screen.getByRole('button', { name: 'Добавить поле' }))
const pick = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }))
const apply = () => fireEvent.click(screen.getByRole('button', { name: 'Применить' }))

describe('FilterBar (amo/Bitrix-style panel)', () => {
  it('shows multiple field rows in one form at the same time', () => {
    render(<Harness />)
    openPanel()
    // первая панель сразу открывает выбор поля (условий ещё нет)
    pick('Имя')
    addFieldBtn()
    pick('Адрес')
    // Оба поля видны в форме одновременно.
    expect(screen.getByText('Имя')).toBeInTheDocument()
    expect(screen.getByText('Адрес')).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('Содержит...')).toHaveLength(2)
  })

  it('fills several fields and applies them together', () => {
    render(<Harness />)
    openPanel()
    pick('Имя')
    addFieldBtn()
    pick('Адрес')
    const inputs = screen.getAllByPlaceholderText('Содержит...')
    fireEvent.change(inputs[0], { target: { value: 'Айгуль' } })
    fireEvent.change(inputs[1], { target: { value: 'Абая' } })
    apply()
    // Оба чипа применились.
    expect(screen.getByText('Айгуль')).toBeInTheDocument()
    expect(screen.getByText('Абая')).toBeInTheDocument()
  })

  it('allows the same field more than once', () => {
    render(<Harness />)
    openPanel()
    pick('Имя')
    addFieldBtn()
    pick('Имя')
    const inputs = screen.getAllByPlaceholderText('Содержит...')
    fireEvent.change(inputs[0], { target: { value: 'А' } })
    fireEvent.change(inputs[1], { target: { value: 'Б' } })
    apply()
    expect(screen.getByText('А')).toBeInTheDocument()
    expect(screen.getByText('Б')).toBeInTheDocument()
  })

  it('removes a field row inside the form', () => {
    render(<Harness />)
    openPanel()
    pick('Имя')
    fireEvent.click(screen.getByLabelText('Убрать поле Имя'))
    expect(screen.queryByPlaceholderText('Содержит...')).not.toBeInTheDocument()
  })

  it('drops empty rows on apply', () => {
    render(<Harness />)
    openPanel()
    pick('Имя') // оставляем пустым
    apply()
    expect(screen.queryByText('Имя:')).not.toBeInTheDocument()
  })

  it('reset clears all applied conditions', () => {
    render(<Harness initial={[{ field: 'name', op: 'contains', value: 'А' }]} />)
    // нижняя кнопка-сводка «Сбросить» очищает применённое
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.queryByText('Имя:')).not.toBeInTheDocument()
  })

  it('removes an applied condition via the chip X', () => {
    render(<Harness initial={[{ field: 'rfm_segment', op: 'in', value: ['Потерянный'] }]} />)
    expect(screen.getByText('Сегмент:')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Убрать фильтр Сегмент'))
    expect(screen.queryByText('Сегмент:')).not.toBeInTheDocument()
  })

  it('creates a new tag option inside the form', async () => {
    const onCreateOption = vi.fn().mockResolvedValue({ value: 't-new', label: 'VIP' })
    const fieldsWithTags: FilterFieldDef[] = [
      { key: 'tags', label: 'Теги', kind: 'multiselect', creatable: true, options: [] },
    ]
    render(<Harness fields={fieldsWithTags} onCreateOption={onCreateOption} />)
    openPanel()
    pick('Теги')
    fireEvent.change(screen.getByPlaceholderText('Поиск или новый тег...'), { target: { value: 'VIP' } })
    fireEvent.click(screen.getByRole('button', { name: /Создать тег/ }))
    await waitFor(() => expect(onCreateOption).toHaveBeenCalledWith('tags', 'VIP'))
  })
})
