import { describe, it, expect } from 'vitest'
import { normalizePhone, isValidPhone, toDialDigits, toE164 } from '@/lib/phone'

describe('normalizePhone — канон E.164 (+7XXXXXXXXXX)', () => {
  it('приводит 11 цифр с 7 к +7…', () => {
    expect(normalizePhone('77057618170')).toBe('+77057618170')
  })
  it('приводит 11 цифр с 8 к +7…', () => {
    expect(normalizePhone('87057618170')).toBe('+77057618170')
  })
  it('приводит 10 цифр к +7…', () => {
    expect(normalizePhone('7057618170')).toBe('+77057618170')
  })
  it('сохраняет уже нормализованный +7…', () => {
    expect(normalizePhone('+77057618170')).toBe('+77057618170')
  })
  it('игнорирует пробелы, скобки и дефисы', () => {
    expect(normalizePhone('+7 (705) 761-81-70')).toBe('+77057618170')
  })
  it('возвращает пустую строку для некорректного номера', () => {
    expect(normalizePhone('12345')).toBe('')
    expect(normalizePhone('')).toBe('')
  })
})

describe('isValidPhone', () => {
  it('true для валидного КЗ-номера в любом формате', () => {
    expect(isValidPhone('77057618170')).toBe(true)
    expect(isValidPhone('+7 705 761 81 70')).toBe(true)
    expect(isValidPhone('87057618170')).toBe(true)
  })
  it('false для мусора', () => {
    expect(isValidPhone('123')).toBe(false)
    expect(isValidPhone('')).toBe(false)
  })
})

describe('toDialDigits — для Beeline/Wazzup (без «+»)', () => {
  it('срезает «+»: 7XXXXXXXXXX', () => {
    expect(toDialDigits('+77057618170')).toBe('77057618170')
    expect(toDialDigits('87057618170')).toBe('77057618170')
    expect(toDialDigits('+7 705 761-81-70')).toBe('77057618170')
  })
})

describe('toE164 — для tel: и отображения', () => {
  it('возвращает +7XXXXXXXXXX', () => {
    expect(toE164('77057618170')).toBe('+77057618170')
  })
})
