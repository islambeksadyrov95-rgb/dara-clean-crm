// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

afterEach(() => cleanup())
import { CatalogColumn, DeliverySection, groupServices, matchesSearch } from './order-form-parts'

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
    address: '', onAddress: () => {}, regionId: '', onRegion: () => {}, carId: '', onCar: () => {},
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
