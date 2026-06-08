'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { autoAssignUnassignedClients } from './actions'
import { Button } from '@/components/ui/button'
import { Users } from 'lucide-react'

type Props = {
  unassignedCount: number
}

export function AssignButton({ unassignedCount }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  if (unassignedCount === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 font-medium shadow-xs">
        <span>✓ Все клиенты распределены по менеджерам</span>
      </div>
    )
  }

  const handleAssign = async () => {
    setLoading(true)
    toast.info('Начинаем автораспределение клиентов...')
    
    try {
      const res = await autoAssignUnassignedClients()
      if (res.success) {
        toast.success(`Успешно распределено клиентов: ${res.count}`)
        router.refresh()
      } else {
        toast.error(res.error || 'Не удалось распределить клиентов')
      }
    } catch (err: any) {
      toast.error(err.message || 'Произошла непредвиденная ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-orange-100 bg-orange-50/50 text-sm shadow-xs w-full sm:w-auto min-w-[320px]">
      <div className="flex-1">
        <div className="font-semibold text-orange-850 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-orange-600" />
          Свободная очередь: {unassignedCount} клинт.
        </div>
        <p className="text-[11px] text-orange-600/90 mt-0.5 leading-tight">
          Клиенты не видны менеджерам и не учитываются в их планах.
        </p>
      </div>
      <Button 
        size="sm" 
        onClick={handleAssign} 
        disabled={loading}
        className="bg-orange-600 hover:bg-orange-700 text-white cursor-pointer ml-auto"
      >
        {loading ? 'Секунду...' : 'Распределить'}
      </Button>
    </div>
  )
}
