import { describe, it, expect } from 'vitest'
import { planLinks } from './reconcile-ghosts'
import type { AgbisSyncOrder } from './sync-types'

/** Minimal AgbisSyncOrder factory — planLinks only reads contrId/orderDate/dorId/amount. */
function mkOrder(p: { dorId: string; contrId: string; orderDate: string; amount?: number }): AgbisSyncOrder {
  return {
    dorId: p.dorId, docNum: null, contrId: p.contrId, amount: p.amount ?? null, debet: null, dolg: null,
    orderDate: p.orderDate, dateOut: null, statusId: null, statusName: null, userId: null, userName: null,
    discount: null, services: [], products: [],
  }
}
const ghost = (id: string, clientId: string, date: string, amount = 0) => ({
  id, client_id: clientId, amount, intake_date: `${date}T05:00:00Z`, created_at: `${date}T05:00:00Z`,
})
const map = (pairs: [string, string][]) => new Map(pairs) // contrId -> clientId

describe('planLinks', () => {
  it('links an unambiguous 1:1 (client, date) match — amount NOT required', () => {
    const orders = [mkOrder({ dorId: '100368', contrId: 'k104116', orderDate: '2026-06-27', amount: 10100 })]
    const ghosts = [ghost('g1', 'c1', '2026-06-27', 0)] // ghost amount 0, Agbis 10100 — must still link
    const { links, ambiguous } = planLinks(orders, ghosts, map([['k104116', 'c1']]))
    expect(ambiguous).toBe(0)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ ghostId: 'g1', clientId: 'c1' })
    expect(links[0].order.dorId).toBe('100368')
  })

  it('skips when TWO Agbis orders share the (client, date) — ambiguous (Ренат 06-27 case)', () => {
    const orders = [
      mkOrder({ dorId: '100378', contrId: 'k10057', orderDate: '2026-06-27' }),
      mkOrder({ dorId: '100376', contrId: 'k10057', orderDate: '2026-06-27' }),
    ]
    const ghosts = [ghost('g1', 'c1', '2026-06-27')]
    const { links, ambiguous } = planLinks(orders, ghosts, map([['k10057', 'c1']]))
    expect(links).toHaveLength(0)
    expect(ambiguous).toBe(1)
  })

  it('skips when TWO ghosts share the (client, date) — ambiguous', () => {
    const orders = [mkOrder({ dorId: '100400', contrId: 'k1', orderDate: '2026-06-27' })]
    const ghosts = [ghost('g1', 'c1', '2026-06-27'), ghost('g2', 'c1', '2026-06-27')]
    const { links, ambiguous } = planLinks(orders, ghosts, map([['k1', 'c1']]))
    expect(links).toHaveLength(0)
    expect(ambiguous).toBe(2)
  })

  it('leaves a ghost pending when no Agbis twin exists in the window', () => {
    const orders = [mkOrder({ dorId: '100401', contrId: 'k1', orderDate: '2026-06-20' })]
    const ghosts = [ghost('g1', 'c1', '2026-06-27')] // different date → no twin
    const { links, ambiguous } = planLinks(orders, ghosts, map([['k1', 'c1']]))
    expect(links).toHaveLength(0)
    expect(ambiguous).toBe(0)
  })

  it('ignores Agbis orders whose contragent is not linked to a CRM client', () => {
    const orders = [mkOrder({ dorId: '100402', contrId: 'k-unlinked', orderDate: '2026-06-27' })]
    const ghosts = [ghost('g1', 'c1', '2026-06-27')]
    const { links } = planLinks(orders, ghosts, map([])) // empty map — contragent unlinked
    expect(links).toHaveLength(0)
  })

  it('matches independently per (client, date) — links the clean one, skips the ambiguous one', () => {
    const orders = [
      mkOrder({ dorId: '100368', contrId: 'kA', orderDate: '2026-06-27', amount: 10100 }), // clean
      mkOrder({ dorId: '100378', contrId: 'kB', orderDate: '2026-06-27' }), // B ambiguous
      mkOrder({ dorId: '100376', contrId: 'kB', orderDate: '2026-06-27' }),
    ]
    const ghosts = [ghost('gA', 'cA', '2026-06-27'), ghost('gB', 'cB', '2026-06-27')]
    const { links, ambiguous } = planLinks(orders, ghosts, map([['kA', 'cA'], ['kB', 'cB']]))
    expect(links).toHaveLength(1)
    expect(links[0].ghostId).toBe('gA')
    expect(ambiguous).toBe(1)
  })
})
