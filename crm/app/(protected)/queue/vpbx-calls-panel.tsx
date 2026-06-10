'use client'

import { useState } from 'react'
import { PhoneOutgoing, PhoneIncoming, RefreshCw, Star } from 'lucide-react'
import type { VpbxCallRow } from './actions'

const FINISH_LABELS: Record<string, string> = {
  ANSWERED: 'Отвечен',
  NOT_ANSWERED: 'Не отвечен',
  BUSY: 'Занято',
  CANCELLED: 'Отменён',
}

const FINISH_COLORS: Record<string, string> = {
  ANSWERED: 'text-emerald-600',
  NOT_ANSWERED: 'text-amber-600',
  BUSY: 'text-amber-600',
  CANCELLED: 'text-red-600',
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function CallCard({ call }: { call: VpbxCallRow }) {
  const [expanded, setExpanded] = useState(false)
  const isOutbound = call.direction === 'outbound'

  return (
    <div className="rounded-lg border bg-white p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          {isOutbound ? (
            <PhoneOutgoing className="w-3.5 h-3.5 text-blue-500" />
          ) : (
            <PhoneIncoming className="w-3.5 h-3.5 text-emerald-500" />
          )}
          <span className="font-medium">{isOutbound ? 'Исходящий' : 'Входящий'}</span>
          {call.finish_status && (
            <span className={`${FINISH_COLORS[call.finish_status] ?? 'text-muted-foreground'}`}>
              · {FINISH_LABELS[call.finish_status] ?? call.finish_status}
            </span>
          )}
          {call.duration > 0 && (
            <span className="text-muted-foreground">· {formatDuration(call.duration)}</span>
          )}
        </div>
        {typeof call.score === 'number' && (
          <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600">
            <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {call.score}/10
          </span>
        )}
      </div>

      {call.is_recorded && call.vpbx_uuid && (
        <audio
          src={`/api/vpbx/recording?uuid=${encodeURIComponent(call.vpbx_uuid)}&preview=1`}
          controls
          preload="none"
          className="w-full h-7"
        />
      )}

      {call.transcription_status === 'pending' && (
        <p className="text-[11px] text-muted-foreground animate-pulse">Транскрибируется…</p>
      )}
      {call.transcription_status === 'failed' && (
        <p className="text-[11px] text-amber-600">Не удалось расшифровать запись</p>
      )}

      {call.summary && <p className="text-[11px] text-muted-foreground leading-snug">{call.summary}</p>}

      {call.transcript && (
        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] text-blue-600 hover:underline"
          >
            {expanded ? 'Скрыть транскрипт' : 'Показать транскрипт'}
          </button>
          {expanded && (
            <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-foreground/80 bg-[#fcfcfb] rounded-md p-2 max-h-48 overflow-auto">
              {call.transcript}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function VpbxCallsPanel({ calls, onRefresh }: { calls: VpbxCallRow[]; onRefresh: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="w-3 h-3" /> Обновить
        </button>
      </div>
      {calls.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-3">
          Записей пока нет. Они появятся автоматически после звонка.
        </p>
      ) : (
        calls.map((call) => <CallCard key={call.id} call={call} />)
      )}
    </div>
  )
}
