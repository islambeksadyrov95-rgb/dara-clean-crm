// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

afterEach(() => cleanup())
import {
  CatalogColumn, TripArmSection, groupServices, matchesSearch, combineAddress,
  emptyArm, armToPayload, isArmReady,
} from './order-form-parts'

describe('combineAddress', () => {
  it('joins non-empty parts with labels', () => {
    expect(combineAddress('ул. Абая', '5', '10', '3')).toBe('ул. Абая, д. 5, кв. 10, эт. 3')
  })
  it('skips empty parts', () => {
    expect(combineAddress('ул. Абая', '', '', '')).toBe('ул. Абая')
    expect(combineAddress('', '', '', '')).toBe('')
  })
})

describe('trip arm helpers', () => {
  it('self arm carries no address/car in the payload', () => {
    expect(armToPayload(emptyArm('1023'))).toEqual({ mode: 'self' })
  })
  it('trip arm combines the address parts and keeps the car', () => {
    expect(armToPayload({ mode: 'trip', street: 'ул. Абая', house: '5', apartment: '', floor: '', carId: '1023' }))
      .toEqual({ mode: 'trip', address: 'ул. Абая, д. 5', carId: '1023' })
  })
  it('isArmReady: self always ready; trip needs street + car', () => {
    expect(isArmReady(emptyArm())).toBe(true)
    expect(isArmReady({ ...emptyArm('1023'), mode: 'trip' })).toBe(false) // no street
    expect(isArmReady({ mode: 'trip', street: 'ул. Абая', house: '', apartment: '', floor: '', carId: '' })).toBe(false) // no car
    expect(isArmReady({ mode: 'trip', street: 'ул. Абая', house: '', apartment: '', floor: '', carId: '1023' })).toBe(true)
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

describe('TripArmSection', () => {
  const cars = [{ id: '1023', name: 'Машина 2' }]
  it('hides trip fields for самовывоз', () => {
    render(<TripArmSection label="Забор" arm={emptyArm()} onChange={() => {}} cars={cars} />)
    expect(screen.queryByLabelText(/Адрес выезда/i)).not.toBeInTheDocument()
  })
  it('shows address + car for выезд, without район/время', () => {
    render(<TripArmSection label="Забор" arm={{ ...emptyArm('1023'), mode: 'trip' }} onChange={() => {}} cars={cars} />)
    expect(screen.getByLabelText('Адрес выезда — Забор')).toBeInTheDocument()
    expect(screen.getByLabelText('Машина — Забор')).toBeInTheDocument()
    expect(screen.queryByLabelText('Район')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Время с')).not.toBeInTheDocument()
  })
  it('toggles mode via the Самовывоз/Выезд buttons', () => {
    const onChange = vi.fn()
    render(<TripArmSection label="Выдача" arm={emptyArm()} onChange={onChange} cars={cars} />)
    fireEvent.click(screen.getByRole('button', { name: 'Выезд' }))
    expect(onChange).toHaveBeenCalledWith({ mode: 'trip' })
  })
})
