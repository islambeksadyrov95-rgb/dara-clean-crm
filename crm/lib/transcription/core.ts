import 'server-only'
import { applyDictionaryFixes } from '@/lib/kazakh-dictionary'

/**
 * Shared transcription + call-scoring core (Groq Whisper + LLM).
 * Used by the manual /api/transcribe route and the VPBX webhook pipeline.
 */

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const WHISPER_MODEL = 'whisper-large-v3'
const SCORE_MODEL = 'llama-3.3-70b-versatile'
const SPEAKER_GAP_SEC = 1.5 // pause longer than this = speaker change
const WHISPER_PROMPT =
  'Сәлеметсіз бе, здравствуйте. Химчистка ковров, кілем тазалау. Қанша тұрады? Сколько стоит? Рахмет, спасибо. Жақсы, хорошо. Жеңілдік бар, скидка есть.'

export type WhisperSegment = { start: number; end: number; text: string }
export type ChatSegment = { speaker: 'manager' | 'client'; text: string; start: number; end: number }

export type TranscriptionResult = {
  raw: string
  corrected: string
  segments: ChatSegment[]
}

export type ScoreParams = {
  transcript: string
  segment: string
  totalOrders: number
  daysSinceLastOrder: number | null
  clientName: string
}

export type ScoreResult = {
  score: number
  summary: string
  strengths: string[]
  improvements: string[]
  /** Дословный ответ клиента на «Откуда вы о нас узнали?», если прозвучал в разговоре. */
  acquisitionAnswer: string | null
}

function groqKey(): string {
  const key = (process.env.GROQ_API_KEY ?? '').trim()
  if (!key) throw new Error('GROQ_API_KEY не задан')
  return key
}

/**
 * Splits Whisper segments into a manager/client dialogue.
 * The manager speaks first (they initiate the call); a pause flips the speaker.
 */
export function assignSpeakers(segments: WhisperSegment[]): ChatSegment[] {
  if (segments.length === 0) return []

  const result: ChatSegment[] = []
  let currentSpeaker: 'manager' | 'client' = 'manager'

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const text = seg.text.trim()
    if (!text) continue

    if (i > 0 && seg.start - segments[i - 1].end >= SPEAKER_GAP_SEC) {
      currentSpeaker = currentSpeaker === 'manager' ? 'client' : 'manager'
    }

    const last = result[result.length - 1]
    if (last && last.speaker === currentSpeaker) {
      last.text += ' ' + text
      last.end = seg.end
    } else {
      result.push({ speaker: currentSpeaker, text, start: seg.start, end: seg.end })
    }
  }

  return result
}

/** Transcribes audio via Groq Whisper, applies dictionary fixes and speaker split. */
export async function transcribeAudio(audio: Blob, filename: string): Promise<TranscriptionResult> {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', WHISPER_MODEL)
  form.append('response_format', 'verbose_json')
  form.append('prompt', WHISPER_PROMPT)

  const res = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey()}` },
    body: form,
  })

  if (!res.ok) {
    throw new Error(`Whisper ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as { text?: string; segments?: WhisperSegment[] }
  const rawText = (data.text ?? '').trim()
  if (!rawText) return { raw: '', corrected: '', segments: [] }

  const { corrected } = applyDictionaryFixes(rawText)
  const fixedSegments = (data.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: applyDictionaryFixes(s.text).corrected,
  }))

  return { raw: rawText, corrected, segments: assignSpeakers(fixedSegments) }
}

/** Scores a call transcript for sales effectiveness (1..10) via Groq LLM. */
export async function scoreCall(params: ScoreParams): Promise<ScoreResult> {
  const prompt = `Ты эксперт по продажам в сфере клининга (химчистка ковров, штор, мебели).
Оцени эффективность звонка менеджера.

ВАЖНО: Разговор может вестись на русском, казахском или смешанном (русско-казахском) языке. Ты должен полностью понимать оба языка.
Результаты анализа (summary, strengths, improvements) напиши на русском языке (если преобладал русский или смешанный) или на казахском языке (если весь разговор велся на казахском).

Контекст клиента:
- Имя: ${params.clientName}
- Сегмент: ${params.segment}
- Заказов ранее: ${params.totalOrders}
- Дней без заказа: ${params.daysSinceLastOrder ?? 'неизвестно'}

Транскрипт звонка:
${params.transcript}

Оцени по шкале 1-10:
- Приветствие и представление
- Выявление потребности
- Презентация услуги
- Работа с возражениями
- Закрытие сделки

Дополнительно: если в разговоре клиент отвечал на вопрос, откуда он узнал о компании
(источник: инстаграм, 2GIS, рекомендация и т.п.) — извлеки его ответ ДОСЛОВНО в поле
acquisition_answer. Если такого ответа не было — null.

Ответь СТРОГО в JSON (без markdown):
{"score": <число 1-10>, "summary": "<итог 2-3 предложения>", "strengths": ["что хорошо"], "improvements": ["что улучшить"], "acquisition_answer": "<дословный ответ или null>"}`

  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SCORE_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    }),
  })

  if (!res.ok) {
    throw new Error(`Groq ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content?.trim() ?? ''
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('LLM вернул ответ без JSON')
  }

  const parsed = JSON.parse(jsonMatch[0]) as ScoreResult & { acquisition_answer?: unknown }
  parsed.score = Math.max(1, Math.min(10, Math.round(parsed.score)))
  parsed.strengths = Array.isArray(parsed.strengths) ? parsed.strengths : []
  parsed.improvements = Array.isArray(parsed.improvements) ? parsed.improvements : []
  // LLM отдаёт snake_case; пустые/не-строковые значения = ответа не было.
  parsed.acquisitionAnswer =
    typeof parsed.acquisition_answer === 'string' && parsed.acquisition_answer.trim()
      ? parsed.acquisition_answer.trim()
      : null
  return parsed
}
