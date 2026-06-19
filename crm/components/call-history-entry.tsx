'use client'

import { useState } from 'react'
import { callLabel, reasonLabel } from '@/lib/call-status'
import type { CallWorkHistoryEntry } from '@/components/call-work-panel'

// DD.MM HH:MM — совпадает с прежним formatTime панели.
function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const STATUS_COLOR: Record<string, string> = {
  reached: 'text-green-600',
  declined: 'text-red-600',
}

/**
 * Одна строка истории звонка из call_logs: статус, время (+ менеджер на /clients),
 * заметка, AI-оценка с summary, аудио-плеер и раскрываемый полный транскрипт.
 * Единый вид для обеих веток CallWorkPanel (/queue и /clients), чтобы запись,
 * её аудио и транскрипт были видны везде, где открыт клиент.
 */
export function CallHistoryEntry({
  entry,
  showManager = false,
}: {
  entry: CallWorkHistoryEntry
  showManager?: boolean
}) {
  const [showTranscript, setShowTranscript] = useState(false)
  const statusColor = STATUS_COLOR[entry.status] ?? 'text-muted-foreground'
  const hasDialogue = (entry.dialogue?.length ?? 0) > 0

  return (
    <div className="border-b border-gray-100 last:border-0 pb-2.5 space-y-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-medium ${statusColor}`}>
          {callLabel(entry.status, entry.sub_status)}
          {reasonLabel(entry.reason) && (
            <span className="text-muted-foreground"> — {reasonLabel(entry.reason)}</span>
          )}
        </span>
        <span className="text-muted-foreground text-[10px] shrink-0">
          {showManager && entry.manager_name ? `${entry.manager_name} · ` : ''}
          {formatTime(entry.created_at)}
        </span>
      </div>

      {entry.notes && (
        <div className="text-muted-foreground text-[11px] bg-gray-50/50 p-1.5 rounded italic">
          “{entry.notes}”
        </div>
      )}

      {entry.call_score != null && (
        <div className="flex items-center gap-1.5">
          <span className="bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded font-bold border border-blue-100">
            Оценка: {entry.call_score}/10
          </span>
          {entry.summary && (
            <span
              className="text-muted-foreground text-[10px] truncate max-w-[180px]"
              title={entry.summary}
            >
              {entry.summary}
            </span>
          )}
        </div>
      )}

      {entry.audio_url && (
        <audio src={entry.audio_url} controls className="w-full h-6 rounded-md bg-gray-50 text-xs" />
      )}

      {(hasDialogue || entry.transcript) && (
        <div>
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="text-[11px] text-blue-600 hover:underline"
          >
            {showTranscript ? 'Скрыть' : hasDialogue ? 'Показать диалог' : 'Показать транскрипт'}
          </button>
          {showTranscript &&
            (hasDialogue ? (
              <div className="mt-1 space-y-1 text-[11px] bg-[#fcfcfb] rounded-md p-2 max-h-48 overflow-auto">
                {entry.dialogue?.map((seg, i) => (
                  <div key={`${seg.start}-${i}`}>
                    <span
                      className={
                        seg.speaker === 'manager'
                          ? 'font-semibold text-blue-700'
                          : 'font-semibold text-emerald-700'
                      }
                    >
                      {seg.speaker === 'manager' ? 'Менеджер' : 'Клиент'}:
                    </span>{' '}
                    <span className="text-foreground/80">{seg.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-foreground/80 bg-[#fcfcfb] rounded-md p-2 max-h-48 overflow-auto">
                {entry.transcript}
              </pre>
            ))}
        </div>
      )}
    </div>
  )
}
