import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('Protected Layout Navigation', () => {
  it('should contain a link to /queue with text "Очередь"', () => {
    const layoutPath = resolve(__dirname, '../app/(protected)/layout.tsx')
    const content = readFileSync(layoutPath, 'utf-8')

    expect(content).toContain('href="/queue"')
    expect(content).toContain('Очередь')
  })

  it('should place queue link before clients link', () => {
    const layoutPath = resolve(__dirname, '../app/(protected)/layout.tsx')
    const content = readFileSync(layoutPath, 'utf-8')

    const queueIndex = content.indexOf('href="/queue"')
    const clientsIndex = content.indexOf('href="/clients"')

    expect(queueIndex).toBeGreaterThan(-1)
    expect(clientsIndex).toBeGreaterThan(-1)
    expect(queueIndex).toBeLessThan(clientsIndex)
  })
})
