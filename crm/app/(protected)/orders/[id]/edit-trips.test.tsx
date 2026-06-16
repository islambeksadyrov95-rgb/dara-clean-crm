// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(() => cleanup())

const h = vi.hoisted(() => ({ formSpy: vi.fn(), updateSpy: vi.fn() }))
vi.mock('@/app/(protected)/queue/order/catalog', () => ({ getOrderFormData: h.formSpy }))
vi.mock('@/app/(protected)/queue/order/actions', () => ({ updateOrderTrips: h.updateSpy }))

import { EditTripsForm } from './edit-trips'

beforeEach(() => {
  h.formSpy.mockReset().mockResolvedValue({
    success: true,
    data: { cars: [{ id: '1023', name: 'Машина 2' }], services: [], warehouses: [], orderTimes: [], carpetTypes: [], carpetShapes: [] },
  })
  h.updateSpy.mockReset().mockResolvedValue({ success: true, tripIds: [] })
})

describe('EditTripsForm', () => {
  it('prefills a выезд arm from an existing trip and submits both arms', async () => {
    const trips = [{ kind: 'pickup' as const, address: 'ул. Абая 1', carId: '1023', syncStatus: 'synced', tripId: '9001' }]
    render(<EditTripsForm orderId="o1" trips={trips} onCancel={() => {}} onSaved={() => {}} />)

    expect(screen.getByLabelText('Адрес выезда — Забор')).toHaveValue('ул. Абая 1')
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }))

    await waitFor(() => expect(h.updateSpy).toHaveBeenCalled())
    const arg = h.updateSpy.mock.calls[0][0]
    expect(arg.orderId).toBe('o1')
    expect(arg.pickup).toEqual({ mode: 'trip', address: 'ул. Абая 1', carId: '1023' })
    expect(arg.delivery).toEqual({ mode: 'self' })
  })

  it('calls onSaved on a successful save (both arms самовывоз)', async () => {
    const onSaved = vi.fn()
    render(<EditTripsForm orderId="o1" trips={[]} onCancel={() => {}} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('shows the error and does not call onSaved when the update fails', async () => {
    h.updateSpy.mockResolvedValueOnce({ success: false, error: 'Не удалось обновить часть выездов' })
    const onSaved = vi.fn()
    render(<EditTripsForm orderId="o1" trips={[]} onCancel={() => {}} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(screen.getByText('Не удалось обновить часть выездов')).toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
  })
})
