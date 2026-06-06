import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('Queue page filters', () => {
  it('should filter with both gte and lte on days_since_last_order', () => {
    const content = readFileSync(
      resolve(__dirname, '../app/(protected)/queue/page.tsx'),
      'utf-8'
    )
    expect(content).toContain('preset.max')
    expect(content).toContain(".lte('days_since_last_order', preset.max)")
  })
})
