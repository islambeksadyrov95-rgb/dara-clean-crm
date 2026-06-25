// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string | { toString(): string }; children: React.ReactNode }) =>
    <a href={typeof href === 'string' ? href : String(href)}>{children}</a>,
}))

import { StuckOrdersBanner } from './stuck-orders-banner'
import type { StuckOrder } from './orders-query'

afterEach(() => cleanup())

const order: StuckOrder = {
  id: 'o1', created_at: '2026-06-25T12:00:00Z', amount: 0,
  sync_status: 'pending', sync_error: 'agbis_error_20', client_name: 'Иван',
}

describe('StuckOrdersBanner', () => {
  it('ничего не рендерит без застрявших заказов', () => {
    const { container } = render(<StuckOrdersBanner orders={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('показывает количество, клиента и причину застрявшего заказа', () => {
    render(<StuckOrdersBanner orders={[order]} />)
    expect(screen.getByText(/не ушли в Агбис/i)).toBeInTheDocument()
    expect(screen.getByText('Иван')).toHaveAttribute('href', '/orders/o1')
    expect(screen.getByText(/agbis_error_20/)).toBeInTheDocument()
  })

  it('закрывается по крестику', () => {
    render(<StuckOrdersBanner orders={[order]} />)
    fireEvent.click(screen.getByLabelText('Закрыть'))
    expect(screen.queryByText(/не ушли в Агбис/i)).not.toBeInTheDocument()
  })
})
