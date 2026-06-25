// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string | { toString(): string }; children: React.ReactNode }) =>
    <a href={typeof href === 'string' ? href : String(href)}>{children}</a>,
}))
vi.mock('./incoming-call-actions', () => ({ getCallerCard: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

import { IncomingCallCardView, callStatusLabel, type ActiveCall } from './incoming-call-notifier'

afterEach(() => cleanup())

const baseCall: ActiveCall = { uuid: 'u1', phone: '+77001112233', clientId: 'c1', finishStatus: null, loading: false, card: null }

describe('callStatusLabel', () => {
  it('состояния звонка', () => {
    expect(callStatusLabel(null)).toBe('Звонит…')
    expect(callStatusLabel('ANSWERED')).toBe('Разговор завершён')
    expect(callStatusLabel('BUSY')).toBe('Пропущенный')
    expect(callStatusLabel('CANCELLED')).toBe('Пропущенный')
  })
})

describe('IncomingCallCardView', () => {
  it('опознанный клиент + последний заказ', () => {
    const call: ActiveCall = {
      ...baseCall,
      card: {
        client: { id: 'c1', name: 'Иван', phone: '+77001112233', totalOrders: 3, lastOrderDate: '2026-06-01' },
        recentOrder: { id: 'o1', docNum: '000123', statusName: 'В исполнении', amount: 15000, createdAt: '2026-06-20T10:00:00Z' },
      },
    }
    render(<IncomingCallCardView call={call} onClose={() => {}} />)
    expect(screen.getByText('Иван')).toBeInTheDocument()
    expect(screen.getByText(/№000123/)).toBeInTheDocument()
    expect(screen.getByText('Открыть клиента')).toHaveAttribute('href', '/clients/c1')
    expect(screen.getByText('Открыть заказ')).toHaveAttribute('href', '/orders/o1')
  })

  it('неизвестный номер → создать клиента с подставленным телефоном', () => {
    const call: ActiveCall = { ...baseCall, phone: '+77009998877', clientId: null, finishStatus: 'CANCELLED', card: { client: null, recentOrder: null } }
    render(<IncomingCallCardView call={call} onClose={() => {}} />)
    expect(screen.getByText('Номер не найден в базе клиентов.')).toBeInTheDocument()
    expect(screen.getByText('Создать клиента')).toHaveAttribute('href', '/clients?newClientPhone=%2B77009998877')
    expect(screen.getByText('Пропущенный')).toBeInTheDocument()
  })

  it('состояние загрузки', () => {
    const call: ActiveCall = { ...baseCall, loading: true }
    render(<IncomingCallCardView call={call} onClose={() => {}} />)
    expect(screen.getByText(/Загрузка данных клиента/)).toBeInTheDocument()
    expect(screen.getByText('Звонит…')).toBeInTheDocument()
  })
})
