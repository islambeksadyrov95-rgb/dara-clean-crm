'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  getClientAcquisition, saveAcquisitionAnswer, type ClientAcquisition,
} from '@/app/(protected)/clients/acquisition-actions'

// Источник клиента в панели звонка/карточке. Самодостаточный компонент:
// источник есть — показывает; ответ на разборе — бейдж; пусто — поле для записи
// ответа («Откуда вы о нас узнали?»), классификацию делает ИИ на сервере.

interface AcquisitionFieldProps {
  clientId: string
}

export function AcquisitionField({ clientId }: AcquisitionFieldProps) {
  const [info, setInfo] = useState<ClientAcquisition | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [answer, setAnswer] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const data = await getClientAcquisition(clientId)
    setInfo(data)
    setLoaded(true)
  }

  useEffect(() => {
    setLoaded(false)
    setAnswer('')
    let active = true
    getClientAcquisition(clientId).then((data) => {
      if (!active) return
      setInfo(data)
      setLoaded(true)
    })
    return () => { active = false }
  }, [clientId])

  const handleSave = async () => {
    if (!answer.trim()) return
    setSaving(true)
    const res = await saveAcquisitionAnswer(clientId, answer)
    if (res.success) {
      if (res.matched) toast.success('Источник определён')
      else toast.info('Ответ записан — источник уточнит администратор')
      await load()
    } else {
      toast.error(res.error)
    }
    setSaving(false)
  }

  if (!loaded) return null

  if (info?.sourceName) {
    return (
      <div className="text-xs text-muted-foreground">
        Источник: <span className="font-medium text-foreground">{info.sourceName}</span>
      </div>
    )
  }

  if (info?.rawAnswer) {
    return (
      <div className="text-xs text-muted-foreground">
        Источник: <span className="italic">«{info.rawAnswer}»</span>{' '}
        <span className="text-amber-600 font-medium">На разборе</span>
      </div>
    )
  }

  return (
    <div className="flex gap-1.5 items-center">
      <Input
        placeholder="Откуда вы о нас узнали? — записать ответ"
        className="h-7 text-xs"
        value={answer}
        disabled={saving}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && answer.trim()) {
            e.preventDefault()
            handleSave()
          }
        }}
      />
      <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled={saving || !answer.trim()} onClick={handleSave}>
        {saving ? '...' : 'Записать'}
      </Button>
    </div>
  )
}
