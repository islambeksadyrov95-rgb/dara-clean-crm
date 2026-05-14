import Link from 'next/link'

export default async function OrderPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const { clientId } = await params

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Создание заказа</h1>
      <p className="text-muted-foreground mb-4">
        Форма заказа для клиента (Phase 7). Client ID: {clientId}
      </p>
      <Link
        href="/queue"
        className="text-sm text-blue-600 hover:underline"
      >
        Вернуться в очередь
      </Link>
    </div>
  )
}
