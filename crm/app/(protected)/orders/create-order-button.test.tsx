// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ searchSpy: vi.fn() }))
vi.mock('@/app/(protected)/search-actions', () => ({ searchClients: h.searchSpy }))
vi.mock('@/app/(protected)/queue/order-form', () => ({
  OrderForm: ({ clientName }: { clientName: string }) => <div>FORM:{clientName}</div>,
}))

import { CreateOrderButton } from './create-order-button'

beforeEach(() => h.searchSpy.mockReset().mockResolvedValue({ success: true, results: [{ id: 'c1', name: 'Иван', phone: '+7700', segment: 'A' }] }))
afterEach(() => cleanup())

describe('CreateOrderButton', () => {
  it('opens the picker, searches, and renders the form for a chosen client', async () => {
    render(<CreateOrderButton />)
    fireEvent.click(screen.getByRole('button', { name: /Создать заказ/i }))
    fireEvent.change(screen.getByPlaceholderText(/Имя или телефон/i), { target: { value: 'Иван' } })
    fireEvent.click(screen.getByRole('button', { name: /Найти/i }))
    const found = await screen.findByText(/Иван/)
    fireEvent.click(found)
    expect(await screen.findByText('FORM:Иван')).toBeInTheDocument()
  })

  it('shows an empty-state when nothing is found', async () => {
    h.searchSpy.mockResolvedValueOnce({ success: true, results: [] })
    render(<CreateOrderButton />)
    fireEvent.click(screen.getByRole('button', { name: /Создать заказ/i }))
    fireEvent.change(screen.getByPlaceholderText(/Имя или телефон/i), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: /Найти/i }))
    await waitFor(() => expect(screen.getByText(/Ничего не найдено/i)).toBeInTheDocument())
  })
})
