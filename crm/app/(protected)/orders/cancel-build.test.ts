import { describe, it, expect } from 'vitest'
import { CancelOrderSchema } from './cancel-build'

const base = { orderId: 'a0000000-0000-4000-8000-000000000001', reason: 8 as const }

describe('CancelOrderSchema', () => {
  it('принимает валидный вход (reason 7/8, comment опционален)', () => {
    expect(CancelOrderSchema.safeParse({ ...base, reason: 7, comment: 'клиент передумал' }).success).toBe(true)
    expect(CancelOrderSchema.safeParse(base).success).toBe(true)
    expect(CancelOrderSchema.safeParse({ ...base, comment: null }).success).toBe(true)
  })
  it('отвергает reason вне 7/8', () => {
    expect(CancelOrderSchema.safeParse({ ...base, reason: 1 }).success).toBe(false)
    expect(CancelOrderSchema.safeParse({ ...base, reason: 9 }).success).toBe(false)
  })
  it('отвергает не-uuid orderId', () => {
    expect(CancelOrderSchema.safeParse({ ...base, orderId: 'abc' }).success).toBe(false)
  })
  it('отвергает comment длиннее 500', () => {
    expect(CancelOrderSchema.safeParse({ ...base, comment: 'x'.repeat(501) }).success).toBe(false)
  })
})
