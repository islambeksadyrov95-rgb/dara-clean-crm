import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('Queue page filters', () => {
  it('should filter with both gte and lte on days_since_last_order', () => {
    // Логика запроса очереди переехала в общий модуль queue-query.ts (SSR + клиент).
    const content = readFileSync(
      resolve(__dirname, '../app/(protected)/queue/queue-query.ts'),
      'utf-8'
    )
    expect(content).toContain('presetMin')
    expect(content).toContain(".gte('days_since_last_order', presetMin)")
    expect(content).toContain(".lte('days_since_last_order', presetMax)")
  })
})
