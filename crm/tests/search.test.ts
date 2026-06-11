import { describe, it, expect } from 'vitest'
import { sanitizeSearchTerm } from '@/lib/search'

describe('sanitizeSearchTerm', () => {
  it('strips PostgREST structural characters', () => {
    expect(sanitizeSearchTerm('a,b')).toBe('a b')
    expect(sanitizeSearchTerm('ООО (Ромашка)')).toBe('ООО Ромашка')
    expect(sanitizeSearchTerm('x*y')).toBe('x y')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitizeSearchTerm('  Иван   Петров ')).toBe('Иван Петров')
  })

  it('leaves a plain term unchanged', () => {
    expect(sanitizeSearchTerm('Айгерим')).toBe('Айгерим')
  })

  it('neutralizes an injection attempt that closes the filter group', () => {
    const result = sanitizeSearchTerm('%,id.gt.0)')
    expect(result).not.toContain(',')
    expect(result).not.toContain('(')
    expect(result).not.toContain(')')
  })
})
