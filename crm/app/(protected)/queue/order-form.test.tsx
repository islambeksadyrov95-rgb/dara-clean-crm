// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(() => cleanup())

const h = vi.hoisted(() => ({ formSpy: vi.fn(), createSpy: vi.fn(), slotsSpy: vi.fn() }))

vi.mock('@/app/(protected)/queue/order/catalog', () => ({ getOrderFormData: h.formSpy }))
vi.mock('@/app/(protected)/queue/order/actions', () => ({ createOrder: h.createSpy }))
vi.mock('@/app/(protected)/queue/order/trip-slots', () => ({ getTripSlots: h.slotsSpy }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { address: 'ул. Абая 1', phone: '+7700' } }) }) }) }),
  }),
}))

import { OrderForm } from './order-form'

const formData = {
  services: [{ tovarId: '1', name: 'Одеяло', price: 5000, unit: null, group: 'Одеяла' }],
  warehouses: [{ id: '1023', name: 'Машина 2' }],
  orderTimes: [{ id: '0', name: 'Не срочный' }],
  regions: [{ id: '1039', name: 'Алмалинский' }],
  cars: [{ id: '1023', name: 'Машина 2' }],
  carpetTypes: [{ strId: '1002336', name: 'Иранский', pricePerM2: 1500 }],
  carpetShapes: [{ shapeFlt: '2', name: 'Прямоугольник' }],
}

beforeEach(() => {
  h.formSpy.mockReset().mockResolvedValue({ success: true, data: formData })
  h.createSpy.mockReset().mockResolvedValue({ success: true, order: { id: 'o1', amount: 5000, agbisStatus: 'synced', dorId: '1', tripId: null, createdAt: 'x' } })
  h.slotsSpy.mockReset().mockResolvedValue({ success: true, slots: ['09:00', '10:00'] })
})

const props = { clientId: '11111111-1111-4111-8111-111111111111', clientName: 'Иван', onDone: vi.fn(), onCancel: vi.fn() }

describe('OrderForm (rebuild)', () => {
  it('loads the catalog and lists a service', async () => {
    render(<OrderForm {...props} />)
    expect(await screen.findByText('Одеяло')).toBeInTheDocument()
  })

  it('creates an order with the selected service', async () => {
    render(<OrderForm {...props} />)
    await screen.findByText('Одеяло')
    fireEvent.click(screen.getByRole('checkbox')) // select the service
    fireEvent.click(screen.getByRole('button', { name: /Создать заказ/i }))
    await waitFor(() => expect(h.createSpy).toHaveBeenCalled())
    const arg = h.createSpy.mock.calls[0][0]
    expect(arg.items[0]).toMatchObject({ tovarId: '1', qty: 1, unitPrice: 5000 })
    expect(arg.deliveryType).toBe('self')
  })

  it('reveals выезд address field when switching to выезд', async () => {
    render(<OrderForm {...props} />)
    await screen.findByText('Одеяло')
    fireEvent.click(screen.getByRole('button', { name: /Выезд.*забрать/i }))
    expect(await screen.findByLabelText(/Адрес выезда/i)).toBeInTheDocument()
  })
})
