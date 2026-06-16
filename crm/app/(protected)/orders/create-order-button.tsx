'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/**
 * «Создать заказ» on /orders — navigates to the full-page order flow at /orders/new
 * (D-2026-06-16: the previous inline expanding block was too cramped for managers).
 */
export function CreateOrderButton() {
  const router = useRouter()
  return <Button size="sm" onClick={() => router.push('/orders/new')}>Создать заказ</Button>
}
