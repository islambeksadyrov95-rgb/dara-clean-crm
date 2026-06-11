'use client'

export const dynamic = 'force-dynamic'

import { useParams, useRouter } from 'next/navigation'
import { WhatsAppPanel } from '@/app/(protected)/queue/whatsapp-panel'

export default function WhatsAppPage() {
  const params = useParams<{ clientId: string }>()
  const router = useRouter()
  const clientId = params.clientId

  return (
    <div className="max-w-md mx-auto py-8">
      <WhatsAppPanel
        clientId={clientId}
        onDone={() => router.push(`/clients/${clientId}`)}
        onCancel={() => router.back()}
      />
    </div>
  )
}
