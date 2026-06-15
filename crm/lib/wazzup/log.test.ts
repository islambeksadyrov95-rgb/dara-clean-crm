import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ insertResult: { error: null } as { error: { message: string } | null }, shouldThrow: false }))
const insertMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (state.shouldThrow) throw new Error('no service role key')
    return { from: () => ({ insert: insertMock }) }
  },
}))

import { logWazzupCall } from '@/lib/wazzup/log'

beforeEach(() => {
  vi.clearAllMocks()
  state.shouldThrow = false
  state.insertResult = { error: null }
  insertMock.mockImplementation(async () => state.insertResult)
})

describe('logWazzupCall', () => {
  it('пишет строку действия в wazzup_api_log', async () => {
    await logWazzupCall({ command: 'message.send', op: 'send', chat_id: '77057618170' })
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(insertMock.mock.calls[0][0]).toMatchObject({ command: 'message.send', chat_id: '77057618170' })
  })

  it('не пробрасывает ошибку наружу при сбое вставки', async () => {
    state.insertResult = { error: { message: 'rls denied' } }
    await expect(logWazzupCall({ command: 'iframe.open' })).resolves.toBeUndefined()
  })

  it('не падает, если admin-клиент недоступен', async () => {
    state.shouldThrow = true
    await expect(logWazzupCall({ command: 'message.send' })).resolves.toBeUndefined()
    expect(insertMock).not.toHaveBeenCalled()
  })
})
