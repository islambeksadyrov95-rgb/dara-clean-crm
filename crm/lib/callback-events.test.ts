// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { CALLBACKS_CHANGED_EVENT, notifyCallbacksChanged } from './callback-events'

describe('notifyCallbacksChanged', () => {
  it('dispatches the callbacks-changed window event', () => {
    const handler = vi.fn()
    window.addEventListener(CALLBACKS_CHANGED_EVENT, handler)
    notifyCallbacksChanged()
    window.removeEventListener(CALLBACKS_CHANGED_EVENT, handler)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
