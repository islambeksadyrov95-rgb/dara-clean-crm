// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ detailSpy: vi.fn() }))
vi.mock('@/app/(protected)/orders/order-detail', () => ({ getOrderDetail: h.detailSpy }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), useParams: () => ({ id: 'o1' }) }))

import OrderDetailPage from './page'

const detail = {
  source: 'crm', id: 'o1', clientId: 'c1', clientName: 'Иван', docNum: '000267', dorId: '100279',
  statusName: 'Новый', amount: 1000, date: '2026-06-16', dateOut: null, comment: 'note',
  address: null, trips: [], syncStatus: 'synced', receiver: null,
  items: [{ name: 'Табурет', qty: 1, unitPrice: 1000, lineAmount: 1000 }],
}

beforeEach(() => h.detailSpy.mockReset().mockResolvedValue({ success: true, data: detail }))
afterEach(() => cleanup())

describe('OrderDetailPage', () => {
  it('renders the order number, client and an item', async () => {
    render(<OrderDetailPage />)
    expect(await screen.findByText(/000267/)).toBeInTheDocument()
    expect(screen.getByText('Иван')).toBeInTheDocument()
    expect(screen.getByText('Табурет')).toBeInTheDocument()
  })

  it('shows an error state when the order is missing', async () => {
    h.detailSpy.mockResolvedValueOnce({ success: false, error: 'Заказ не найден' })
    render(<OrderDetailPage />)
    expect(await screen.findByText('Заказ не найден')).toBeInTheDocument()
  })
})
