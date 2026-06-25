// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ searchSpy: vi.fn(), pushSpy: vi.fn(), createSpy: vi.fn() }))
vi.mock('@/app/(protected)/search-actions', () => ({ searchClients: h.searchSpy }))
vi.mock('@/app/(protected)/clients/actions', () => ({ createClient: h.createSpy }))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.pushSpy }) }))
vi.mock('@/app/(protected)/queue/order-form', () => ({
  OrderForm: ({ clientName }: { clientName: string }) => <div>FORM:{clientName}</div>,
}))

import { NewOrderClient } from './new-order-client'

beforeEach(() => h.searchSpy.mockReset().mockResolvedValue({ success: true, results: [{ id: 'c1', name: 'Иван', phone: '+7700', segment: 'A' }] }))
afterEach(() => cleanup())

describe('NewOrderClient', () => {
  it('searches and renders the form for a chosen client', async () => {
    render(<NewOrderClient />)
    fireEvent.change(screen.getByPlaceholderText(/Имя или телефон/i), { target: { value: 'Иван' } })
    fireEvent.click(screen.getByRole('button', { name: /Найти/i }))
    const found = await screen.findByText(/Иван/)
    fireEvent.click(found)
    expect(await screen.findByText('FORM:Иван')).toBeInTheDocument()
  })

  it('shows an empty-state when nothing is found', async () => {
    h.searchSpy.mockResolvedValueOnce({ success: true, results: [] })
    render(<NewOrderClient />)
    fireEvent.change(screen.getByPlaceholderText(/Имя или телефон/i), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: /Найти/i }))
    await waitFor(() => expect(screen.getByText(/Ничего не найдено/i)).toBeInTheDocument())
  })

  it('creates a new client inline and opens the form', async () => {
    h.createSpy.mockResolvedValueOnce({ success: true, clientId: 'c9' })
    render(<NewOrderClient />)
    fireEvent.click(screen.getByRole('button', { name: /Новый клиент/i }))
    fireEvent.change(screen.getByPlaceholderText(/Имя клиента/i), { target: { value: 'Пётр' } })
    fireEvent.change(screen.getByPlaceholderText(/Телефон/i), { target: { value: '+77071234567' } })
    fireEvent.click(screen.getByRole('button', { name: /Создать и продолжить/i }))
    expect(await screen.findByText('FORM:Пётр')).toBeInTheDocument()
    expect(h.createSpy).toHaveBeenCalledWith('Пётр', '+77071234567', undefined)
  })

  it('bounces back to search when the phone already exists', async () => {
    h.createSpy.mockResolvedValueOnce({ success: false, error: 'Клиент с таким номером телефона уже существует' })
    render(<NewOrderClient />)
    fireEvent.click(screen.getByRole('button', { name: /Новый клиент/i }))
    fireEvent.change(screen.getByPlaceholderText(/Имя клиента/i), { target: { value: 'Пётр' } })
    fireEvent.change(screen.getByPlaceholderText(/Телефон/i), { target: { value: '+77071234567' } })
    fireEvent.click(screen.getByRole('button', { name: /Создать и продолжить/i }))
    await waitFor(() => expect(h.searchSpy).toHaveBeenCalledWith('+77071234567'))
    expect(await screen.findByPlaceholderText(/Имя или телефон/i)).toBeInTheDocument()
  })
})
