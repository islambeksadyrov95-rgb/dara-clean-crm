export const dynamic = 'force-dynamic'

import { NewOrderClient } from './new-order-client'

export default function NewOrderPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Новый заказ</h1>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <NewOrderClient />
      </div>
    </div>
  )
}
