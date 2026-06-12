// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

afterEach(cleanup)
import { FilterBar } from './filter-bar'
import type { FilterFieldDef, FilterCondition } from '@/lib/filters/types'

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

describe('FilterBar', () => {
  it('adds a text condition through the add-filter flow', () => {
    const onChange = vi.fn()
    render(<FilterBar fields={FIELDS} conditions={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /\+ Фильтр/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Имя' }))
    fireEvent.change(screen.getByPlaceholderText('Содержит...'), { target: { value: 'Айгуль' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))

    expect(onChange).toHaveBeenCalledWith([{ field: 'name', op: 'contains', value: 'Айгуль' }])
  })

  it('appends a new condition, keeping existing ones (multiple filters)', () => {
    const onChange = vi.fn()
    const conditions: FilterCondition[] = [{ field: 'name', op: 'contains', value: 'А' }]
    render(<FilterBar fields={FIELDS} conditions={conditions} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /\+ Фильтр/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Кол-во заказов' }))
    fireEvent.change(screen.getByPlaceholderText('от'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))

    expect(onChange).toHaveBeenCalledWith([
      { field: 'name', op: 'contains', value: 'А' },
      { field: 'total_orders', op: 'between', value: { from: '2' } },
    ])
  })

  it('allows the same field more than once (no one-per-field limit)', () => {
    const onChange = vi.fn()
    const conditions: FilterCondition[] = [{ field: 'name', op: 'contains', value: 'А' }]
    render(<FilterBar fields={FIELDS} conditions={conditions} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /\+ Фильтр/ }))
    // Поле «Имя» по-прежнему доступно в меню, хотя уже используется.
    fireEvent.click(screen.getByRole('button', { name: 'Имя' }))
    fireEvent.change(screen.getByPlaceholderText('Содержит...'), { target: { value: 'Б' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))

    expect(onChange).toHaveBeenCalledWith([
      { field: 'name', op: 'contains', value: 'А' },
      { field: 'name', op: 'contains', value: 'Б' },
    ])
  })

  it('renders chips for active conditions and removes them', () => {
    const onChange = vi.fn()
    const conditions: FilterCondition[] = [
      { field: 'rfm_segment', op: 'in', value: ['Потерянный'] },
    ]
    render(<FilterBar fields={FIELDS} conditions={conditions} onChange={onChange} />)

    expect(screen.getByText(/Сегмент:/)).toBeInTheDocument()
    expect(screen.getByText(/Потерянный/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Убрать фильтр Сегмент'))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('does not emit empty conditions', () => {
    const onChange = vi.fn()
    render(<FilterBar fields={FIELDS} conditions={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /\+ Фильтр/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Имя' }))
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows reset button only when conditions exist and clears all', () => {
    const onChange = vi.fn()
    render(
      <FilterBar
        fields={FIELDS}
        conditions={[{ field: 'name', op: 'contains', value: 'А' }]}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('creates a new tag option from the value editor', async () => {
    const onChange = vi.fn()
    const onCreateOption = vi.fn().mockResolvedValue({ value: 't-new', label: 'VIP' })
    const fieldsWithTags: FilterFieldDef[] = [
      { key: 'tags', label: 'Теги', kind: 'multiselect', creatable: true, options: [] },
    ]
    render(
      <FilterBar
        fields={fieldsWithTags}
        conditions={[]}
        onChange={onChange}
        onCreateOption={onCreateOption}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /\+ Фильтр/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Теги' }))
    fireEvent.change(screen.getByPlaceholderText('Поиск или новый тег...'), { target: { value: 'VIP' } })
    fireEvent.click(screen.getByRole('button', { name: /Создать тег/ }))

    await waitFor(() => expect(onCreateOption).toHaveBeenCalledWith('tags', 'VIP'))
  })
})
