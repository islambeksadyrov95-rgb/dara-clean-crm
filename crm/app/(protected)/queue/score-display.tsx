'use client'

import { useEffect, useState } from 'react'

type ScoreResult = {
  score: number
  summary: string
  strengths: string[]
  improvements: string[]
}

type Props = {
  result: ScoreResult
  onClose: () => void
}

const REACTIONS: Record<number, { emoji: string; label: string; color: string }> = {
  1: { emoji: '😔', label: 'Слабо...', color: 'text-red-600' },
  2: { emoji: '😔', label: 'Слабо...', color: 'text-red-600' },
  3: { emoji: '😔', label: 'Слабо...', color: 'text-red-500' },
  4: { emoji: '🤔', label: 'Можно лучше', color: 'text-orange-500' },
  5: { emoji: '🤔', label: 'Можно лучше', color: 'text-orange-500' },
  6: { emoji: '👍', label: 'Хорошо!', color: 'text-yellow-500' },
  7: { emoji: '👍', label: 'Хорошо!', color: 'text-green-500' },
  8: { emoji: '🔥', label: 'Отлично!', color: 'text-green-600' },
  9: { emoji: '🔥', label: 'Отлично!', color: 'text-green-600' },
  10: { emoji: '🎉', label: 'Идеально!', color: 'text-emerald-600' },
}

function getBarColor(score: number): string {
  if (score <= 3) return 'bg-red-500'
  if (score <= 5) return 'bg-orange-500'
  if (score <= 7) return 'bg-yellow-500'
  return 'bg-green-500'
}

export function ScoreDisplay({ result, onClose }: Props) {
  const [animatedScore, setAnimatedScore] = useState(0)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    // Animate score from 0 to result.score
    let current = 0
    const interval = setInterval(() => {
      current++
      setAnimatedScore(current)
      if (current >= result.score) {
        clearInterval(interval)
        setTimeout(() => setShowDetails(true), 300)
      }
    }, 100)
    return () => clearInterval(interval)
  }, [result.score])

  const reaction = REACTIONS[result.score] ?? REACTIONS[5]

  return (
    <div className="space-y-3 animate-in fade-in duration-500">
      {/* Score bar */}
      <div className="text-center">
        <div className="text-4xl mb-1">{reaction.emoji}</div>
        <div className={`text-lg font-bold ${reaction.color}`}>{reaction.label}</div>
        <div className="text-3xl font-bold mt-1">{animatedScore}/10</div>
      </div>

      {/* Progress bar */}
      <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${getBarColor(result.score)}`}
          style={{ width: `${animatedScore * 10}%` }}
        />
      </div>

      {/* Details */}
      {showDetails && (
        <div className="space-y-2 animate-in slide-in-from-bottom-2 duration-300">
          {/* Summary */}
          <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-2">
            {result.summary}
          </div>

          {/* Strengths */}
          {result.strengths.length > 0 && (
            <div>
              <div className="text-[10px] text-green-600 uppercase tracking-wide mb-1">Сильные стороны</div>
              {result.strengths.map((s, i) => (
                <div key={i} className="text-xs text-gray-600 flex gap-1">
                  <span className="text-green-500">+</span> {s}
                </div>
              ))}
            </div>
          )}

          {/* Improvements */}
          {result.improvements.length > 0 && (
            <div>
              <div className="text-[10px] text-orange-600 uppercase tracking-wide mb-1">Что улучшить</div>
              {result.improvements.map((s, i) => (
                <div key={i} className="text-xs text-gray-600 flex gap-1">
                  <span className="text-orange-500">-</span> {s}
                </div>
              ))}
            </div>
          )}

          <button onClick={onClose} className="w-full text-xs text-muted-foreground hover:text-foreground py-1">
            Закрыть
          </button>
        </div>
      )}
    </div>
  )
}
