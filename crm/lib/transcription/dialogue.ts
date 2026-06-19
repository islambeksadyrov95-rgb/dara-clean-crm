// Чистые типы/хелперы диалога Менеджер/Клиент — БЕЗ 'server-only', чтобы их могли
// импортировать и серверные actions, и клиентские компоненты, и тесты, не таща за
// собой Groq/server-only из core.ts.

export type DialogueSegment = { speaker: 'manager' | 'client'; text: string; start: number; end: number }

/** Safely narrows a jsonb value (call_logs.dialogue) to a typed dialogue array. */
export function parseDialogue(value: unknown): DialogueSegment[] | null {
  if (!Array.isArray(value)) return null
  const segs = value.filter(
    (s): s is DialogueSegment =>
      typeof s === 'object' &&
      s !== null &&
      (s.speaker === 'manager' || s.speaker === 'client') &&
      typeof s.text === 'string' &&
      typeof s.start === 'number' &&
      typeof s.end === 'number'
  )
  return segs.length > 0 ? segs : null
}
