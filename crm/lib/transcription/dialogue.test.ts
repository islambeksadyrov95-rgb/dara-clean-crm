import { describe, it, expect } from 'vitest'
import { parseDialogue } from './dialogue'

describe('parseDialogue', () => {
  it('возвращает типизированный массив для валидного диалога', () => {
    const raw = [
      { speaker: 'manager', text: 'Здравствуйте', start: 0, end: 1.2 },
      { speaker: 'client', text: 'Сәлеметсіз бе', start: 1.5, end: 3 },
    ]
    expect(parseDialogue(raw)).toEqual(raw)
  })

  it('возвращает null для не-массива', () => {
    expect(parseDialogue(null)).toBeNull()
    expect(parseDialogue(undefined)).toBeNull()
    expect(parseDialogue('текст')).toBeNull()
    expect(parseDialogue({ speaker: 'manager' })).toBeNull()
  })

  it('возвращает null для пустого массива', () => {
    expect(parseDialogue([])).toBeNull()
  })

  it('отбрасывает сегменты с неизвестным спикером', () => {
    const raw = [
      { speaker: 'manager', text: 'ok', start: 0, end: 1 },
      { speaker: 'robot', text: 'нет', start: 1, end: 2 },
    ]
    expect(parseDialogue(raw)).toEqual([{ speaker: 'manager', text: 'ok', start: 0, end: 1 }])
  })

  it('отбрасывает сегменты с отсутствующими/неверными полями', () => {
    const raw = [
      { speaker: 'client', text: 'ok', start: 0, end: 1 },
      { speaker: 'client', text: 123, start: 1, end: 2 },
      { speaker: 'manager', start: 2, end: 3 },
      { speaker: 'manager', text: 'no-times' },
      null,
      'строка',
    ]
    expect(parseDialogue(raw)).toEqual([{ speaker: 'client', text: 'ok', start: 0, end: 1 }])
  })
})
