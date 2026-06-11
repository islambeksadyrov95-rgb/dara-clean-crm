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

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY not set' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
      console.error('[api/transcribe] Whisper error', whisperRes.status, await whisperRes.text())
      return NextResponse.json({ error: 'Не удалось распознать запись' }, { status: 500 })
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

    // Загружаем аудиозапись звонка в Supabase Storage
    let audioUrl: string | null = null
    try {
      const adminSupabase = createAdminClient()
      const fileName = `recording-${Date.now()}-${Math.random().toString(36).substring(7)}.webm`
      const arrayBuffer = await audio.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      const { data: uploadData, error: uploadError } = await adminSupabase.storage
        .from('call-recordings')
        .upload(fileName, buffer, {
          contentType: 'audio/webm',
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        console.error('Failed to upload call recording to storage:', uploadError.message)
      } else if (uploadData) {
        // Корзина приватная: храним путь файла, ссылку подписываем при чтении истории.
        audioUrl = fileName
        console.log('Call recording uploaded:', fileName)
      }
    } catch (uploadErr: any) {
      console.error('Exception during call recording upload:', uploadErr.message)
    }

    return NextResponse.json({
      raw: whisperText,
      corrected,
      segments: chatSegments,
      audioUrl,
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
    console.error('[api/transcribe] exception', e)
    return NextResponse.json({ error: 'Не удалось распознать запись' }, { status: 500 })
  }
}
