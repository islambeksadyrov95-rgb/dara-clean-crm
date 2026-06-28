import { createAdminClient } from '@/lib/supabase/admin'
import type { AgbisSyncOrder } from './sync-types'

/**
 * Ghost reconciliation (read-sync side, D-2026-06-28-conservative-reconcile).
 * A CRM order can fail to push (agbis_order_id stays NULL → "ghost") while the same order DOES
 * exist in Agbis — created manually by a manager, or a push that committed-but-timed-out. read-sync
 * imports that Agbis order into order_history, leaving TWO physical rows for one logical order with
 * no shared key, so dedup can't merge them (double-count + duplicate in the list).
 *
 * This links the ghost to its Agbis dor — but ONLY on an unambiguous 1:1 match by (client, calendar
 * date). NO amount match: a "нулевой ковёр" ghost is amount 0 in CRM but measured (>0) in Agbis, so
 * amount would wrongly reject the real twin. If a (client, date) has >1 Agbis order OR >1 ghost it is
 * AMBIGUOUS → skipped + logged, never guessed (owner: "консервативно"; proven needed by Ренат 06-27
 * who had two same-day orders). Fail-closed: any uncertainty leaves the ghost untouched.
 *
 * On link the CRM order takes the Agbis dor/doc/status AND amount (so recalc counts it once via the
 * CRM row while dedup drops the history twin — leaving amount 0 would lose the money). Service role.
 */

const ALMATY_TZ = 'Asia/Almaty'
const GHOST_STATUSES = ['pending', 'local']

type AdminClient = ReturnType<typeof createAdminClient>
type Ghost = { id: string; client_id: string; amount: number; intake_date: string | null; created_at: string }
type LinkPlan = { ghostId: string; clientId: string; order: AgbisSyncOrder }

export type ReconcileResult = { linked: number; ambiguous: number; plannedLinks?: number }

const nonNeg = (n: number | null): number => Math.max(0, Math.round(n ?? 0))

/** Almaty calendar date (yyyy-mm-dd) of a timestamptz — matches how Agbis dates are calendar-keyed. */
function almatyDate(ts: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ALMATY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts))
}

const ghostDate = (g: Ghost): string => almatyDate(g.intake_date ?? g.created_at)
const keyOf = (clientId: string, date: string): string => `${clientId}|${date}`

/** Pending/local CRM orders without a dor (ghosts) for the given clients. */
async function loadGhosts(admin: AdminClient, clientIds: string[]): Promise<Ghost[]> {
  if (clientIds.length === 0) return []
  const out: Ghost[] = []
  for (let i = 0; i < clientIds.length; i += 200) {
    const { data, error } = await admin
      .from('orders')
      .select('id, client_id, amount, intake_date, created_at')
      .in('client_id', clientIds.slice(i, i + 200))
      .is('agbis_order_id', null)
      .is('cancelled_at', null)
      .in('sync_status', GHOST_STATUSES)
    if (error) throw new Error('Не удалось загрузить незавершённые CRM-заказы')
    out.push(...((data ?? []) as Ghost[]))
  }
  return out
}

/** Build the unambiguous 1:1 (client,date) link plan. Multiple on either side → ambiguous (skipped). */
export function planLinks(
  orders: AgbisSyncOrder[],
  ghosts: Ghost[],
  clientByContrId: Map<string, string>,
): { links: LinkPlan[]; ambiguous: number } {
  const agbisByKey = new Map<string, AgbisSyncOrder[]>()
  for (const o of orders) {
    const clientId = clientByContrId.get(o.contrId)
    if (!clientId || !o.orderDate) continue
    const k = keyOf(clientId, o.orderDate)
    agbisByKey.set(k, [...(agbisByKey.get(k) ?? []), o])
  }
  const ghostsByKey = new Map<string, Ghost[]>()
  for (const g of ghosts) {
    const k = keyOf(g.client_id, ghostDate(g))
    ghostsByKey.set(k, [...(ghostsByKey.get(k) ?? []), g])
  }
  const links: LinkPlan[] = []
  let ambiguous = 0
  for (const [k, gs] of ghostsByKey) {
    const os = agbisByKey.get(k)
    if (!os) continue // no Agbis twin in this window — leave the ghost pending
    if (gs.length === 1 && os.length === 1) links.push({ ghostId: gs[0].id, clientId: gs[0].client_id, order: os[0] })
    else ambiguous += gs.length
  }
  if (ambiguous > 0) console.warn(`[agbis.reconcileGhosts] ${ambiguous} ghost(s) skipped — ambiguous (client+date not 1:1)`)
  return { links, ambiguous }
}

/** Link one ghost to its Agbis twin. Amount: prefer the Agbis sum, never downgrade a positive to 0. */
async function applyLink(admin: AdminClient, plan: LinkPlan, ghostAmount: number): Promise<void> {
  const o = plan.order
  const incoming = nonNeg(o.amount)
  await admin
    .from('orders')
    .update({
      agbis_order_id: o.dorId,
      agbis_doc_num: o.docNum,
      agbis_status_id: o.statusId,
      agbis_status_name: o.statusName,
      amount: incoming > 0 ? incoming : ghostAmount,
      sync_status: 'synced',
      sync_error: null,
      agbis_synced_at: new Date().toISOString(),
    })
    .eq('id', plan.ghostId)
    .is('agbis_order_id', null) // guard: never overwrite an already-linked order (concurrent drain)
}

/**
 * Reconcile ghosts against a window of Agbis orders. Returns the set of affected client ids so the
 * caller folds them into recalc_client_aggregates (the link changes which rows count).
 */
export async function reconcileGhostOrders(
  orders: AgbisSyncOrder[],
  clientByContrId: Map<string, string>,
  opts: { dryRun?: boolean } = {},
): Promise<ReconcileResult & { affectedClientIds: string[] }> {
  const admin = createAdminClient()
  const clientIds = [...new Set([...clientByContrId.values()])]
  const ghosts = await loadGhosts(admin, clientIds)
  const amountById = new Map(ghosts.map((g) => [g.id, g.amount]))
  const { links, ambiguous } = planLinks(orders, ghosts, clientByContrId)

  if (opts.dryRun) return { linked: 0, ambiguous, plannedLinks: links.length, affectedClientIds: [] }

  for (const plan of links) await applyLink(admin, plan, amountById.get(plan.ghostId) ?? 0)
  return { linked: links.length, ambiguous, affectedClientIds: [...new Set(links.map((l) => l.clientId))] }
}
