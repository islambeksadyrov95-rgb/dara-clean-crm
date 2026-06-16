// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ pushSpy: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.pushSpy }) }))

import { CreateOrderButton } from './create-order-button'

beforeEach(() => h.pushSpy.mockReset())
afterEach(() => cleanup())

describe('CreateOrderButton', () => {
  it('navigates to /orders/new on click', () => {
    render(<CreateOrderButton />)
    fireEvent.click(screen.getByRole('button', { name: /Создать заказ/i }))
    expect(h.pushSpy).toHaveBeenCalledWith('/orders/new')
  })
})
