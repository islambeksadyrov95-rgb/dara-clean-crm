'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { OrderForm } from '@/app/(protected)/queue/order-form'
import { Button } from '@/components/ui/button'

type ClientInfo = {
  id: string
  name: string
  total_orders: number
}

export default function OrderPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const router = useRouter()
  const [clientId, setClientId] = useState<string>('')
  const [client, setClient] = useState<ClientInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Next 16: params is a Promise — резолвим в эффекте.
  useEffect(() => {
    params.then(({ clientId: id }) => setClientId(id))
  }, [params])

  useEffect(() => {
    if (!clientId) return
    const supabase = createClient()
    supabase
      .from('clients')
      .select('id, name, total_orders')
      .eq('id', clientId)
      .single()
      .then(({ data, error: queryError }) => {
        if (queryError) {
          setError('Не удалось загрузить клиента')
        } else {
          setClient(data as ClientInfo | null)
        }
        setLoading(false)
      })
  }, [clientId])

  if (loading) {
    return <div className="text-muted-foreground py-8 text-center">Загрузка...</div>
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <Button variant="outline" onClick={() => router.push('/queue')}>
          Вернуться в очередь
        </Button>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="py-8 text-center">
        <p className="text-muted-foreground mb-4">Клиент не найден</p>
        <Button variant="outline" onClick={() => router.push('/queue')}>
          Вернуться в очередь
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto py-8">
      <OrderForm
        clientId={client.id}
        clientName={client.name}
        totalOrders={client.total_orders ?? 0}
        onDone={() => router.push(`/clients/${clientId}`)}
        onCancel={() => router.back()}
      />
    </div>
  )
}
