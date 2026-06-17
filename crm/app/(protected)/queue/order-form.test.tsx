// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(() => cleanup())

const h = vi.hoisted(() => ({ formSpy: vi.fn(), createSpy: vi.fn() }))

vi.mock('@/app/(protected)/queue/order/catalog', () => ({ getOrderFormData: h.formSpy }))
vi.mock('@/app/(protected)/queue/order/actions', () => ({ createOrder: h.createSpy }))
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
  cars: [{ id: '1023', name: 'Машина 2' }],
  carpetTypes: [{ strId: '1002336', name: 'Иранский', pricePerM2: 1500 }],
  carpetShapes: [{ shapeFlt: '2', name: 'Прямоугольник' }],
}

beforeEach(() => {
  h.formSpy.mockReset().mockResolvedValue({ success: true, data: formData })
  h.createSpy.mockReset().mockResolvedValue({ success: true, order: { id: 'o1', amount: 5000, agbisStatus: 'synced', dorId: '1', tripIds: [], createdAt: 'x' } })
})

const props = { clientId: '11111111-1111-4111-8111-111111111111', clientName: 'Иван', onDone: vi.fn(), onCancel: vi.fn() }

describe('OrderForm (rebuild)', () => {
  it('loads the catalog and lists a service', async () => {
    render(<OrderForm {...props} />)
    expect(await screen.findByText('Одеяло')).toBeInTheDocument()
  })

  it('creates a самовывоз order with the selected service', async () => {
    render(<OrderForm {...props} />)
    await screen.findByText('Одеяло')
    fireEvent.click(screen.getAllByRole('checkbox')[0]) // select the service
    fireEvent.click(screen.getByRole('button', { name: 'Самовывоз' })) // выезд (default) → самовывоз
    fireEvent.click(screen.getByRole('button', { name: /Создать заказ/i }))
    await waitFor(() => expect(h.createSpy).toHaveBeenCalled())
    const arg = h.createSpy.mock.calls[0][0]
    expect(arg.items[0]).toMatchObject({ tovarId: '1', qty: 1, unitPrice: 5000 })
    expect(arg.pickup).toEqual({ mode: 'self' })
    expect(arg.delivery).toEqual({ mode: 'self' })
  })

  it('выезд (default): prefills the address and submits both legs to the same address/car', async () => {
    render(<OrderForm {...props} />)
    await screen.findByText('Одеяло')
    fireEvent.click(screen.getAllByRole('checkbox')[0]) // select the service
    // выезд is the default — the машина dropdown + address are already shown; just pick the car
    fireEvent.change(screen.getByLabelText('Машина'), { target: { value: '1023' } })
    const addr = await screen.findByLabelText('Адрес выезда')
    expect(addr).toHaveValue('ул. Абая 1') // prefilled from the client
    fireEvent.click(screen.getByRole('button', { name: /Создать заказ/i }))
    await waitFor(() => expect(h.createSpy).toHaveBeenCalled())
    const arg = h.createSpy.mock.calls[0][0]
    // Both legs go to the same address/car — no Забор/Выдача split.
    expect(arg.pickup).toEqual({ mode: 'trip', address: 'ул. Абая 1', carId: '1023' })
    expect(arg.delivery).toEqual({ mode: 'trip', address: 'ул. Абая 1', carId: '1023' })
  })

  it('blocks submit on выезд without a машина (address is never silently dropped)', async () => {
    render(<OrderForm {...props} />)
    await screen.findByText('Одеяло')
    fireEvent.click(screen.getAllByRole('checkbox')[0]) // select the service
    // выезд default, no машина picked → submit disabled, no order goes through with a lost address
    expect(screen.getByRole('button', { name: /Создать заказ/i })).toBeDisabled()
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('adds a carpet from the services list and submits it (самовывоз)', async () => {
    render(<OrderForm {...props} />)
    await screen.findByText('Иранский')
    fireEvent.click(screen.getAllByRole('checkbox')[1]) // carpet row (after the service row)
    fireEvent.change(screen.getByLabelText('Форма — Иранский'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Размер 1 — Иранский'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Размер 2 — Иранский'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Самовывоз' })) // enable submit (no выезд needed)
    fireEvent.click(screen.getByRole('button', { name: /Создать заказ/i }))
    await waitFor(() => expect(h.createSpy).toHaveBeenCalled())
    const arg = h.createSpy.mock.calls[0][0]
    expect(arg.carpets[0]).toMatchObject({ typeStrId: '1002336', shapeFlt: '2', dim1: 2, dim2: 3 })
  })
})
