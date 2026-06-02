import { NextRequest, NextResponse } from 'next/server'
import { applyDictionaryFixes } from '@/lib/kazakh-dictionary'

const GROQ_API_KEY = (process.env.GROQ_API_KEY ?? '').trim()
const GROQ_URL = 'https://api.groq.com/openai/v1'
const WHISPER_MODEL = 'whisper-large-v3'

// Пауза > этого значения = смена спикера
const SPEAKER_GAP_SEC = 1.5

type WhisperSegment = { start: number; end: number; text: string }
type ChatSegment = { speaker: 'manager' | 'client'; text: string; start: number; end: number }

/**
 * Разбивает сегменты Whisper на чат: пауза > SPEAKER_GAP_SEC = смена спикера.
 * Первый спикер = менеджер (он инициирует звонок).
 */
function assignSpeakers(segments: WhisperSegment[]): ChatSegment[] {
  if (segments.length === 0) return []

  const result: ChatSegment[] = []
  let currentSpeaker: 'manager' | 'client' = 'manager'

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const text = seg.text.trim()
    if (!text) continue

    // Смена спикера при паузе
    if (i > 0) {
      const gap = seg.start - segments[i - 1].end
      if (gap >= SPEAKER_GAP_SEC) {
        currentSpeaker = currentSpeaker === 'manager' ? 'client' : 'manager'
      }
    }

    // Склеиваем соседние сегменты одного спикера
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

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY not set' }, { status: 500 })
  }

  const formData = await req.formData()
  const audio = formData.get('audio') as File | null
  if (!audio) {
    return NextResponse.json({ error: 'No audio file' }, { status: 400 })
  }

  try {
    const whisperForm = new FormData()
    whisperForm.append('file', audio, 'recording.webm')
    whisperForm.append('model', WHISPER_MODEL)
    whisperForm.append('response_format', 'verbose_json')
    whisperForm.append('prompt', 'Сәлеметсіз бе, здравствуйте. Химчистка ковров, кілем тазалау. Қанша тұрады? Сколько стоит? Рахмет, спасибо. Жақсы, хорошо. Жеңілдік бар, скидка есть.')

    const whisperRes = await fetch(`${GROQ_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: whisperForm,
    })

    if (!whisperRes.ok) {
      const err = await whisperRes.text()
      return NextResponse.json({ error: `Whisper: ${err}` }, { status: 500 })
    }

    const whisperData = await whisperRes.json()
    const whisperText = (whisperData.text ?? '').trim()

    if (!whisperText) {
      return NextResponse.json({ raw: '', corrected: '', segments: [] })
    }

    // Сегменты с таймкодами
    const rawSegments: WhisperSegment[] = (whisperData.segments ?? []).map((s: { start: number; end: number; text: string }) => ({
      start: s.start, end: s.end, text: s.text,
    }))

    // Словарные замены на полный текст
    const { corrected, changes } = applyDictionaryFixes(whisperText)

    // Словарные замены на каждый сегмент + назначение спикеров
    const fixedSegments = rawSegments.map(s => ({
      ...s, text: applyDictionaryFixes(s.text).corrected,
    }))
    const chatSegments = assignSpeakers(fixedSegments)

    return NextResponse.json({
      raw: whisperText,
      corrected,
      segments: chatSegments,
      log: {
        whisper_in: `audio ${Math.round(audio.size / 1024)}KB`,
        whisper_out: whisperText,
        dict_changes: changes,
        dict_out: corrected,
        segments_count: rawSegments.length,
        chat_segments: chatSegments.length,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
