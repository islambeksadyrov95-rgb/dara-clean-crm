'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'

type Props = {
  onTranscriptReady: (fullText: string, durationSec: number) => void
}

type ChatSegment = { speaker: 'manager' | 'client'; text: string; start: number; end: number }

type LogData = {
  whisper_in: string
  whisper_out: string
  dict_changes: string[]
  dict_out: string
  segments_count?: number
  chat_segments?: number
}

export function CallTranscript({ onTranscriptReady }: Props) {
  const [recording, setRecording] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [chatSegments, setChatSegments] = useState<ChatSegment[]>([])
  const [finalText, setFinalText] = useState('')
  const [whisperRaw, setWhisperRaw] = useState('')
  const [logData, setLogData] = useState<LogData | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<string[]>([])
  const stoppedRef = useRef(false)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [lines, interim, finalText, chatSegments])

  const startRecording = useCallback(async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) {
      setError('Браузер не поддерживает распознавание речи. Используйте Chrome.')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Нет доступа к микрофону')
      return
    }
    streamRef.current = stream

    // Reset
    setError('')
    setLines([])
    setInterim('')
    setFinalText('')
    setChatSegments([])
    setWhisperRaw('')
    setLogData(null)
    setShowLog(false)
    linesRef.current = []
    stoppedRef.current = false
    chunksRef.current = []

    // MediaRecorder — captures audio for Whisper
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    })
    recorderRef.current = recorder
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.start(1000)

    // SpeechRecognition — live preview
    const recognition = new SpeechRecognitionAPI()
    recognitionRef.current = recognition
    // ru-RU для live preview. Финальный транскрипт от Whisper определяет оба языка автоматически.
    recognition.lang = 'ru-RU'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          linesRef.current = [...linesRef.current, text]
          setLines([...linesRef.current])
          setInterim('')
        } else {
          interimText += text
        }
      }
      if (interimText) setInterim(interimText)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed') setError('Микрофон заблокирован')
      else if (event.error !== 'aborted' && event.error !== 'no-speech') setError(`Ошибка: ${event.error}`)
    }

    recognition.onend = () => {
      if (!stoppedRef.current) {
        try { recognition.start() } catch { /* already running */ }
      }
    }

    recognition.start()

    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    setRecording(true)
    setDuration(0)
  }, [])

  const stopRecording = useCallback(async () => {
    stoppedRef.current = true
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }

    const dur = Math.floor((Date.now() - startTimeRef.current) / 1000)
    setDuration(dur)
    setRecording(false)

    // Stop SpeechRecognition
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }

    // Stop MediaRecorder — wait for final data
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
    }

    // Stop mic
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    // Send full audio to Whisper
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    if (blob.size < 5000) {
      const fallback = linesRef.current.join(' ').trim()
      if (fallback) {
        setFinalText(fallback)
        onTranscriptReady(fallback, dur)
      }
      return
    }

    setProcessing(true)
    try {
      const fd = new FormData()
      fd.append('audio', blob, 'recording.webm')
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()
      const text = data.corrected || data.raw || linesRef.current.join(' ').trim()
      const segments: ChatSegment[] = data.segments ?? []

      setWhisperRaw(data.raw || '')
      setFinalText(text)
      setChatSegments(segments)
      if (data.log) setLogData(data.log)
      setProcessing(false)
      if (text) onTranscriptReady(text, dur)
    } catch {
      setProcessing(false)
      const fallback = linesRef.current.join(' ').trim()
      if (fallback) {
        setFinalText(fallback)
        onTranscriptReady(fallback, dur)
      }
      setError('Whisper недоступен, использован браузерный транскрипт')
    }
  }, [onTranscriptReady])

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const fmtTimestamp = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {!recording ? (
          <Button size="sm" variant="outline" onClick={startRecording} className="flex-1" disabled={processing}>
            🎙 Запись
          </Button>
        ) : (
          <Button size="sm" variant="destructive" onClick={stopRecording} className="flex-1">
            <span className="animate-pulse">🔴</span> Стоп ({fmt(duration)})
          </Button>
        )}
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      {processing && (
        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 text-center animate-pulse">
          Обработка аудио...
        </div>
      )}

      {/* Чат-транскрипт (после обработки Whisper) */}
      {chatSegments.length > 0 && (
        <>
          <div ref={scrollRef} className="border rounded-lg p-3 min-h-[200px] max-h-[400px] overflow-y-auto space-y-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Диалог</div>
            {chatSegments.map((seg, i) => (
              <div key={i} className={`flex ${seg.speaker === 'manager' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${
                  seg.speaker === 'manager'
                    ? 'bg-blue-100 text-blue-900'
                    : 'bg-gray-100 text-gray-900'
                }`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-medium">
                      {seg.speaker === 'manager' ? 'Менеджер' : 'Клиент'}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {fmtTimestamp(seg.start)}
                    </span>
                  </div>
                  <div className="leading-relaxed">{seg.text}</div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowLog(v => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            {showLog ? 'Скрыть лог' : 'Показать лог обработки'}
          </button>

          {showLog && (
            <div className="space-y-3 border rounded-lg p-3 bg-gray-50 text-xs">
              <div>
                <div className="text-[10px] text-blue-600 uppercase tracking-wide mb-0.5 font-medium">Браузер (live)</div>
                <div className="text-gray-600 whitespace-pre-wrap bg-white rounded p-1.5 border">
                  {linesRef.current.join(' ') || <span className="text-gray-400 italic">пусто</span>}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-orange-600 uppercase tracking-wide mb-0.5 font-medium">Whisper (аудио → текст)</div>
                <div className="text-gray-500 mb-1">{logData?.whisper_in || ''}</div>
                <div className="text-gray-700 whitespace-pre-wrap bg-white rounded p-1.5 border">
                  {whisperRaw || <span className="text-gray-400 italic">пусто</span>}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-green-600 uppercase tracking-wide mb-0.5 font-medium">Словарь (regex замены)</div>
                {logData?.dict_changes && logData.dict_changes.length > 0 ? (
                  <div className="mb-1 space-y-0.5">
                    {logData.dict_changes.map((c, i) => (
                      <div key={i} className="text-green-700 font-mono">{c}</div>
                    ))}
                  </div>
                ) : (
                  <div className="text-gray-400 italic mb-1">замен не было</div>
                )}
                <div className="text-gray-700 whitespace-pre-wrap bg-white rounded p-1.5 border">
                  {logData?.dict_out || finalText}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-purple-600 uppercase tracking-wide mb-0.5 font-medium">Сегменты</div>
                <div className="text-gray-500">
                  Whisper: {logData?.segments_count ?? '?'} → Чат: {logData?.chat_segments ?? '?'} реплик
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Fallback: сплошной текст (если сегментов нет) */}
      {finalText && chatSegments.length === 0 && (
        <div ref={scrollRef} className="bg-green-50 border border-green-200 rounded-lg p-3 min-h-[200px] max-h-[400px] overflow-y-auto text-sm leading-relaxed">
          <div className="text-[10px] text-green-600 uppercase tracking-wide mb-1">Транскрипт</div>
          <span className="text-gray-700 whitespace-pre-wrap">{finalText}</span>
        </div>
      )}

      {/* Live preview during recording */}
      {!finalText && (recording || lines.length > 0) && (() => {
        const fullText = lines.join(' ') + (interim ? ' ' + interim : '')
        const words = fullText.split(/\s+/).filter(Boolean)
        return (
          <div ref={scrollRef} className="bg-gray-50 rounded-lg p-3 min-h-[200px] max-h-[400px] overflow-y-auto text-sm leading-relaxed">
            {words.length > 0 ? (
              <span className="text-gray-700 whitespace-pre-wrap">
                {words.join(' ')}
                {interim ? <span className="text-gray-400">...</span> : null}
              </span>
            ) : recording ? (
              <div className="text-gray-400 text-center">Говорите...</div>
            ) : null}
          </div>
        )
      })()}
    </div>
  )
}
