// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

afterEach(() => cleanup())
import { CatalogColumn, DeliverySection, groupServices, matchesSearch, combineAddress } from './order-form-parts'

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

const carpetTypes = [{ strId: '1002336', name: 'Иранский', pricePerM2: 1500 }]
const carpetShapes = [{ shapeFlt: '2', name: 'Прямоугольник' }]

const catalogBase = {
  grouped: groupServices(services),
  qty: {} as Record<string, number>,
  search: '',
  onSearch: () => {},
  onToggle: vi.fn(),
  onQty: () => {},
  carpetTypes,
  carpetShapes,
  carpetCfg: {} as Record<string, { shapeFlt: string; dim1: string; dim2: string }>,
  onCarpetToggle: vi.fn(),
  onCarpetField: vi.fn(),
}

describe('CatalogColumn', () => {
  it('renders services and toggles selection', () => {
    const onToggle = vi.fn()
    render(<CatalogColumn {...catalogBase} onToggle={onToggle} />)
    expect(screen.getByText('Одеяло')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onToggle).toHaveBeenCalledWith('1')
  })

  it('renders carpet types as rows and toggles them', () => {
    const onCarpetToggle = vi.fn()
    render(<CatalogColumn {...catalogBase} onCarpetToggle={onCarpetToggle} />)
    expect(screen.getByText('Иранский')).toBeInTheDocument()
    // checkbox order: service rows first, carpet rows after
    fireEvent.click(screen.getAllByRole('checkbox')[2])
    expect(onCarpetToggle).toHaveBeenCalledWith('1002336')
  })

  it('reveals shape/size fields when a carpet type is selected', () => {
    render(<CatalogColumn {...catalogBase} carpetCfg={{ '1002336': { shapeFlt: '', dim1: '', dim2: '' } }} />)
    expect(screen.getByLabelText('Форма — Иранский')).toBeInTheDocument()
    expect(screen.getByLabelText('Размер 1 — Иранский')).toBeInTheDocument()
  })
})

describe('DeliverySection', () => {
  const base = {
    form: { services: [], warehouses: [], orderTimes: [], cars: [{ id: '2', name: 'М' }], carpetTypes: [], carpetShapes: [] },
    street: '', onStreet: () => {}, house: '', onHouse: () => {}, apartment: '', onApartment: () => {}, floor: '', onFloor: () => {},
    carId: '', onCar: () => {},
  }
  it('hides trip fields for самовывоз', () => {
    render(<DeliverySection {...base} type="self" onType={() => {}} />)
    expect(screen.queryByLabelText(/Адрес выезда/i)).not.toBeInTheDocument()
  })
  it('shows address + car for выезд, without район/время', () => {
    render(<DeliverySection {...base} type="pickup" onType={() => {}} />)
    expect(screen.getByLabelText(/Адрес выезда/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Машина')).toBeInTheDocument()
    expect(screen.queryByLabelText('Район')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Время с')).not.toBeInTheDocument()
  })
})
