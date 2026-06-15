// Тариф Agbis API — ПАКЕТЫ транзакций (подтверждено Леонидом Бурмакиным, 2026-06-15).
// Платится только запись (успешная коммерческая команда). Чтение — бесплатно.
// Источник: docs/integrations/agbis-api/06-tariffs.md, D-2026-06-15-arch-tariff-packages.

export const AGBIS_PACKAGES = [
  { transactions: 2000, price: 5000 },
  { transactions: 5000, price: 10000 },
  { transactions: 10000, price: 15000 },
  { transactions: 30000, price: 36000 },
  { transactions: 50000, price: 50000 },
  { transactions: 100000, price: 80000 },
  { transactions: 200000, price: 100000 },
  { transactions: 500000, price: 150000 },
] as const

export type AgbisPackage = {
  transactions: number
  price: number
  perTx: number
  exceedsMax: boolean
}

/**
 * Наименьший пакет, покрывающий объём платных транзакций за период.
 * Цена пакета фиксирована (предоплата пула), perTx — справочная цена за транзакцию.
 * exceedsMax=true, если объём превысил максимальный пакет (нужно несколько пакетов).
 */
export function coveringPackage(paidCount: number): AgbisPackage {
  const largest = AGBIS_PACKAGES[AGBIS_PACKAGES.length - 1]
  const pkg = AGBIS_PACKAGES.find((p) => p.transactions >= paidCount) ?? largest
  return {
    transactions: pkg.transactions,
    price: pkg.price,
    perTx: pkg.price / pkg.transactions,
    exceedsMax: paidCount > largest.transactions,
  }
}
