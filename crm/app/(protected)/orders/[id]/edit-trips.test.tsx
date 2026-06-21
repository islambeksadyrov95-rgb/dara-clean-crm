// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(() => cleanup())

const h = vi.hoisted(() => ({ carsSpy: vi.fn(), updateSpy: vi.fn() }))
vi.mock('@/app/(protected)/queue/order/actions', () => ({ getTripCars: h.carsSpy, updateOrderTrips: h.updateSpy }))

import { EditTripsForm } from './edit-trips'

beforeEach(() => {
  h.carsSpy.mockReset().mockResolvedValue({ success: true, cars: [{ id: '1023', name: 'Машина 2' }] })
  h.updateSpy.mockReset().mockResolvedValue({ success: true, tripIds: [] })
})

describe('EditTripsForm', () => {
  it('prefills the unified block from existing trips + dates and submits both legs to one address', async () => {
    const trips = [
      { kind: 'pickup' as const, address: 'ул. Абая 1', carId: '1023', syncStatus: 'synced', tripId: '9001', boundAt: '2026-06-21T10:00:00Z' },
      { kind: 'delivery' as const, address: 'ул. Абая 1', carId: '1023', syncStatus: 'synced', tripId: '9002', boundAt: null },
    ]
    render(<EditTripsForm orderId="o1" trips={trips} intakeAt="2026-06-16T09:00" deliveryAt="2026-06-19T14:00" onCancel={() => {}} onSaved={() => {}} />)

    expect(await screen.findByLabelText('Адрес выезда')).toHaveValue('ул. Абая 1')
    expect(screen.getByLabelText('Забор (дата/время)')).toHaveValue('2026-06-16T09:00')
    expect(screen.getByLabelText('Выдача (дата/время)')).toHaveValue('2026-06-19T14:00')
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }))

    await waitFor(() => expect(h.updateSpy).toHaveBeenCalled())
    const arg = h.updateSpy.mock.calls[0][0]
    expect(arg.orderId).toBe('o1')
    expect(arg.pickup).toEqual({ mode: 'trip', address: 'ул. Абая 1', carId: '1023' })
    expect(arg.delivery).toEqual({ mode: 'trip', address: 'ул. Абая 1', carId: '1023' })
    expect(arg.intakeDate).toBe('2026-06-16T09:00')
    expect(arg.deliveryAt).toBe('2026-06-19T14:00')
  })

  it('calls onSaved on a successful save (самовывоз — no trips)', async () => {
    const onSaved = vi.fn()
    render(<EditTripsForm orderId="o1" trips={[]} intakeAt={null} deliveryAt={null} onCancel={() => {}} onSaved={onSaved} />)
    fireEvent.click(await screen.findByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(h.updateSpy.mock.calls[0][0].pickup).toEqual({ mode: 'self' })
  })

  it('shows the error and does not call onSaved when the update fails', async () => {
    h.updateSpy.mockResolvedValueOnce({ success: false, error: 'Не удалось обновить часть выездов' })
    const onSaved = vi.fn()
    render(<EditTripsForm orderId="o1" trips={[]} intakeAt={null} deliveryAt={null} onCancel={() => {}} onSaved={onSaved} />)
    fireEvent.click(await screen.findByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(screen.getByText('Не удалось обновить часть выездов')).toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows a car-loading error state when the catalog fails to load', async () => {
    h.carsSpy.mockResolvedValueOnce({ success: false, error: 'boom' })
    render(<EditTripsForm orderId="o1" trips={[]} intakeAt={null} deliveryAt={null} onCancel={() => {}} onSaved={() => {}} />)
    expect(await screen.findByText('Не удалось загрузить список машин')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Сохранить/ })).not.toBeInTheDocument()
  })
})
