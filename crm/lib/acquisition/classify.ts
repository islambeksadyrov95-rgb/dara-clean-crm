// Классификация ответа «Откуда вы о нас узнали?» по строгому справочнику источников.
// Принцип (решение пользователя): ИИ сопоставляет ответ ТОЛЬКО с существующими
// источниками. Не уверен / не нашёл — sourceId = null, клиент попадает в очередь
// разбора админа. ИИ никогда не создаёт новые источники.
//
// Чистые функции (prompt + разбор ответа) отделены от сетевого вызова — тестируются без сети.

export type AcquisitionSourceOption = { id: string; name: string; synonyms: string[] }

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const CLASSIFY_MODEL = 'llama-3.3-70b-versatile'

export function buildClassifyPrompt(rawAnswer: string, sources: AcquisitionSourceOption[]): string {
  const list = sources
    .map((s) => `- "${s.name}"${s.synonyms.length ? ` (синонимы: ${s.synonyms.join(', ')})` : ''}`)
    .join('\n')
  return `Клиент химчистки ответил на вопрос «Откуда вы о нас узнали?»:
«${rawAnswer}»

Список допустимых источников (выбирать СТРОГО из него, ничего не придумывать):
${list}

Если ответ уверенно соответствует одному источнику из списка — верни его название ДОСЛОВНО.
Если ответ неоднозначный, не из списка или непонятный — верни null.
Ответ может быть на русском или казахском языке.

Ответь СТРОГО в JSON (без markdown):
{"source_name": "<название из списка или null>", "confidence": "high" | "low"}`
}

/** Разбирает ответ LLM: только high-confidence точное имя из списка даёт sourceId. */
export function resolveClassification(
  llmContent: string,
  sources: AcquisitionSourceOption[],
): { sourceId: string | null } {
  const jsonMatch = llmContent.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { sourceId: null }
  try {
    const parsed: unknown = JSON.parse(jsonMatch[0])
    if (typeof parsed !== 'object' || parsed === null) return { sourceId: null }
    const sourceName = (parsed as Record<string, unknown>).source_name
    const confidence = (parsed as Record<string, unknown>).confidence
    if (typeof sourceName !== 'string' || confidence !== 'high') return { sourceId: null }
    const match = sources.find((s) => s.name === sourceName)
    return { sourceId: match?.id ?? null }
  } catch {
    return { sourceId: null }
  }
}

/** Сетевой вызов Groq. Ошибки сети/LLM = null (на разбор), основной поток не ломаем. */
export async function classifyAcquisitionAnswer(
  rawAnswer: string,
  sources: AcquisitionSourceOption[],
): Promise<{ sourceId: string | null }> {
  const key = (process.env.GROQ_API_KEY ?? '').trim()
  if (!key || sources.length === 0) return { sourceId: null }

  try {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        messages: [{ role: 'user', content: buildClassifyPrompt(rawAnswer, sources) }],
        temperature: 0,
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      console.error('[acquisition] classify failed:', res.status)
      return { sourceId: null }
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return resolveClassification(data.choices?.[0]?.message?.content ?? '', sources)
  } catch (err) {
    console.error('[acquisition] classify error:', err instanceof Error ? err.message : err)
    return { sourceId: null }
  }
}
