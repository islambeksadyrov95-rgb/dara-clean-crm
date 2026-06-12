import { describe, it, expect } from 'vitest'
import { buildClassifyPrompt, resolveClassification } from '@/lib/acquisition/classify'

const SOURCES = [
  { id: 's1', name: 'Instagram', synonyms: ['инста', 'сторис'] },
  { id: 's2', name: '2GIS', synonyms: ['2гис'] },
]

describe('buildClassifyPrompt', () => {
  it('includes the answer, source names and synonyms', () => {
    const prompt = buildClassifyPrompt('мне подруга в инсте скинула', SOURCES)
    expect(prompt).toContain('мне подруга в инсте скинула')
    expect(prompt).toContain('Instagram')
    expect(prompt).toContain('инста')
    expect(prompt).toContain('2GIS')
  })
})

describe('resolveClassification', () => {
  it('maps high-confidence exact source name to its id', () => {
    expect(resolveClassification('{"source_name":"Instagram","confidence":"high"}', SOURCES))
      .toEqual({ sourceId: 's1' })
  })

  it('returns null for low confidence — на разбор админу, источник НЕ создаётся', () => {
    expect(resolveClassification('{"source_name":"Instagram","confidence":"low"}', SOURCES))
      .toEqual({ sourceId: null })
  })

  it('returns null for unknown source name (никаких новых источников от ИИ)', () => {
    expect(resolveClassification('{"source_name":"TikTok","confidence":"high"}', SOURCES))
      .toEqual({ sourceId: null })
  })

  it('returns null for null source and for garbage output', () => {
    expect(resolveClassification('{"source_name":null,"confidence":"high"}', SOURCES)).toEqual({ sourceId: null })
    expect(resolveClassification('not json at all', SOURCES)).toEqual({ sourceId: null })
  })

  it('extracts JSON from markdown-wrapped responses', () => {
    expect(resolveClassification('```json\n{"source_name":"2GIS","confidence":"high"}\n```', SOURCES))
      .toEqual({ sourceId: 's2' })
  })
})
