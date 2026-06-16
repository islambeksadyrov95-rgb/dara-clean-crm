// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

afterEach(() => cleanup())
import { CatalogColumn, DeliverySection, CarpetSection, groupServices, matchesSearch, combineAddress } from './order-form-parts'

describe('combineAddress', () => {
  it('joins non-empty parts with labels', () => {
    expect(combineAddress('ул. Абая', '5', '10', '3')).toBe('ул. Абая, д. 5, кв. 10, эт. 3')
  })
  it('skips empty parts', () => {
    expect(combineAddress('ул. Абая', '', '', '')).toBe('ул. Абая')
    expect(combineAddress('', '', '', '')).toBe('')
  })
})

const services = [
  { tovarId: '1', name: 'Одеяло', price: 5000, unit: null, group: 'Одеяла' },
  { tovarId: '2', name: 'Плед', price: 3000, unit: null, group: 'Одеяла' },
]

describe('pure helpers', () => {
  it('groups services by group name', () => {
    expect(groupServices(services)).toEqual([['Одеяла', services]])
  })
  it('matchesSearch is case-insensitive and empty-query passes', () => {
    expect(matchesSearch(services[0], '')).toBe(true)
    expect(matchesSearch(services[0], 'одеял')).toBe(true)
    expect(matchesSearch(services[0], 'плед')).toBe(false)
  })
})

describe('CatalogColumn', () => {
  it('renders services and toggles selection', () => {
    const onToggle = vi.fn()
    render(<CatalogColumn grouped={groupServices(services)} qty={{}} search=""
      onSearch={() => {}} onToggle={onToggle} onQty={() => {}} />)
    expect(screen.getByText('Одеяло')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onToggle).toHaveBeenCalledWith('1')
  })
})

describe('DeliverySection', () => {
  const base = {
    form: { services: [], warehouses: [], orderTimes: [], regions: [{ id: '1', name: 'Р' }], cars: [{ id: '2', name: 'М' }] },
    street: '', onStreet: () => {}, house: '', onHouse: () => {}, apartment: '', onApartment: () => {}, floor: '', onFloor: () => {},
    regionId: '', onRegion: () => {}, carId: '', onCar: () => {},
    tripHr: '', onHr: () => {}, tripHrTo: '', onHrTo: () => {}, slots: ['09:00'], endOptions: ['10:00'],
  }
  it('hides trip fields for самовывоз', () => {
    render(<DeliverySection {...base} type="self" onType={() => {}} />)
    expect(screen.queryByLabelText(/Адрес выезда/i)).not.toBeInTheDocument()
  })
  it('shows trip fields for выезд', () => {
    render(<DeliverySection {...base} type="pickup" onType={() => {}} />)
    expect(screen.getByLabelText(/Адрес выезда/i)).toBeInTheDocument()
  })
})

describe('CarpetSection', () => {
  const types = [{ strId: '1002336', name: 'Иранский', pricePerM2: 1500 }]
  const shapes = [{ shapeFlt: '2', name: 'Прямоугольник' }]

  it('adds a carpet with computed area once type/shape/dims are set', () => {
    const onAdd = vi.fn()
    render(<CarpetSection types={types} shapes={shapes} carpets={[]} onAdd={onAdd} onRemove={() => {}} />)
    fireEvent.change(screen.getByLabelText('Тип ковра'), { target: { value: '1002336' } })
    fireEvent.change(screen.getByLabelText('Форма'), { target: { value: '2' } })
    fireEvent.change(screen.getByPlaceholderText('Размер 1 (м)'), { target: { value: '2' } })
    fireEvent.change(screen.getByPlaceholderText('Размер 2 (м)'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /Добавить ковёр/i }))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ typeStrId: '1002336', shapeFlt: '2', dim1: 2, dim2: 3 }))
  })

  it('shows a fallback when carpet options are unavailable', () => {
    render(<CarpetSection types={[]} shapes={[]} carpets={[]} onAdd={() => {}} onRemove={() => {}} />)
    expect(screen.getByText(/Ковры недоступны/i)).toBeInTheDocument()
  })
})
