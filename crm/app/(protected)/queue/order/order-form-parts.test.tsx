// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

afterEach(() => cleanup())
import {
  CatalogColumn, TripBlock, groupServices, matchesSearch, combineAddress,
  emptyTrip, tripChoiceToArm, isTripChoiceReady,
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

describe('trip choice helpers', () => {
  it('самовывоз → arm with no address/car', () => {
    expect(tripChoiceToArm(emptyTrip('self'))).toEqual({ mode: 'self' })
  })
  it('выезд → trip arm combining address + apartment, keeping the car', () => {
    expect(tripChoiceToArm({ mode: 'trip', carId: '1023', address: 'ул. Абая', apartment: '10' }))
      .toEqual({ mode: 'trip', address: 'ул. Абая, кв. 10', carId: '1023' })
  })
  it('isTripChoiceReady: самовывоз ready; выезд needs BOTH a car and an address (no silent address loss)', () => {
    expect(isTripChoiceReady(emptyTrip('self'))).toBe(true) // самовывоз
    expect(isTripChoiceReady(emptyTrip())).toBe(false) // выезд по умолчанию, машина ещё не выбрана
    expect(isTripChoiceReady({ mode: 'trip', carId: '1023', address: '', apartment: '' })).toBe(false) // нет адреса
    expect(isTripChoiceReady({ mode: 'trip', carId: '', address: 'ул. Абая', apartment: '' })).toBe(false) // адрес есть, машины нет → НЕ теряем молча
    expect(isTripChoiceReady({ mode: 'trip', carId: '1023', address: 'ул. Абая', apartment: '' })).toBe(true)
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

describe('TripBlock', () => {
  const cars = [{ id: '1023', name: 'Машина 2' }]
  const dateProps = { intakeDate: '2026-06-16T09:00', onIntake: () => {}, deliveryAt: '', onDelivery: () => {} }

  it('самовывоз: hides машина/address but always shows both dates', () => {
    render(<TripBlock choice={emptyTrip('self')} onChange={() => {}} cars={cars} {...dateProps} />)
    expect(screen.queryByLabelText('Адрес выезда')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Машина')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Забор (дата/время)')).toBeInTheDocument()
    expect(screen.getByLabelText('Выдача (дата/время)')).toBeInTheDocument()
  })

  it('выезд (default): reveals машина + one address + apartment (no Забор/Выдача split)', () => {
    render(<TripBlock choice={{ mode: 'trip', carId: '1023', address: 'ул. Абая 1', apartment: '' }} onChange={() => {}} cars={cars} {...dateProps} />)
    expect(screen.getByLabelText('Машина')).toBeInTheDocument()
    expect(screen.getByLabelText('Адрес выезда')).toHaveValue('ул. Абая 1')
    expect(screen.getByLabelText('Квартира')).toBeInTheDocument()
  })

  it('the Самовывоз toggle switches mode to self', () => {
    const onChange = vi.fn()
    render(<TripBlock choice={emptyTrip()} onChange={onChange} cars={cars} {...dateProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Самовывоз' }))
    expect(onChange).toHaveBeenCalledWith({ mode: 'self' })
  })

  it('picking a машина (выезд mode) patches carId', () => {
    const onChange = vi.fn()
    render(<TripBlock choice={emptyTrip()} onChange={onChange} cars={cars} {...dateProps} />)
    fireEvent.change(screen.getByLabelText('Машина'), { target: { value: '1023' } })
    expect(onChange).toHaveBeenCalledWith({ carId: '1023' })
  })
})
