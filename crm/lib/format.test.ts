import { describe, it, expect } from 'vitest'
import { fmtTenge } from './format'

const SP = String.fromCharCode(32) // regular space (avoid literal NBSP ambiguity in source)

describe('fmtTenge', () => {
  it('formats whole tenge with ru grouping (regular space) and the ₸ sign', () => {
    expect(fmtTenge(15000)).toBe(`15${SP}000${SP}₸`)
    expect(fmtTenge(0)).toBe(`0${SP}₸`)
    expect(fmtTenge(15000)).not.toContain(String.fromCharCode(160)) // no NBSP leaked
  })
})
