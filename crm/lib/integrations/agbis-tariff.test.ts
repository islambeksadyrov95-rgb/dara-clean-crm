import { describe, it, expect } from 'vitest'
import { AGBIS_PACKAGES, coveringPackage } from '@/lib/integrations/agbis-tariff'

describe('AGBIS_PACKAGES', () => {
  it('отсортированы по возрастанию и совпадают с тарифом Леонида', () => {
    expect(AGBIS_PACKAGES[0]).toEqual({ transactions: 2000, price: 5000 })
    expect(AGBIS_PACKAGES[AGBIS_PACKAGES.length - 1]).toEqual({ transactions: 500000, price: 150000 })
  })
})

describe('coveringPackage', () => {
  it('подбирает наименьший пакет, покрывающий объём платных транзакций', () => {
    const r = coveringPackage(720)
    expect(r.transactions).toBe(2000)
    expect(r.price).toBe(5000)
    expect(r.perTx).toBeCloseTo(2.5)
    expect(r.exceedsMax).toBe(false)
  })

  it('граница: ровно размер пакета не переходит в следующий', () => {
    expect(coveringPackage(2000).transactions).toBe(2000)
    expect(coveringPackage(2001).transactions).toBe(5000)
  })

  it('средний объём → дешевле за транзакцию', () => {
    const r = coveringPackage(60000)
    expect(r.transactions).toBe(100000)
    expect(r.price).toBe(80000)
    expect(r.perTx).toBeCloseTo(0.8)
  })

  it('сверх максимального пакета — берём максимальный и помечаем exceedsMax', () => {
    const r = coveringPackage(600000)
    expect(r.transactions).toBe(500000)
    expect(r.exceedsMax).toBe(true)
  })

  it('ноль платных → наименьший пакет, exceedsMax=false', () => {
    expect(coveringPackage(0).transactions).toBe(2000)
  })
})
