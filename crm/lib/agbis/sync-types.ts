import { z } from 'zod'
import { money } from './helpers'
import { agbisDateToYmd } from './windows'

/**
 * Typed shapes + mappers for the Agbis sync reads (ClientsByDateTimeForAll /
 * OrderByDateTimeForAll). Responses are already URL-decoded by the client. Mapping is
 * defensive: invalid rows map to null and are dropped by the command wrapper (R1 — no raw
 * Agbis payload leaks; R6 — concrete types, no untyped casts). Money → integer whole tenge.
 */

export type AgbisSyncClient = {
  contrId: string
  fullname: string | null
  name: string | null
  telephone: string | null // landline
  telephCell: string | null // mobile (+...)
  email: string | null
  address: string | null
  gender: number | null
  isActive: boolean
  isDeleted: boolean
  orderCount: number | null
  bonus: number | null // read-only mirror (whole tenge)
  deposit: number | null // read-only mirror (whole tenge)
  dolg: number | null // read-only mirror (whole tenge)
  paySumm: number | null // lifetime order sum (whole tenge)
  firstOrderDate: string | null // yyyy-mm-dd
  lastOrderDate: string | null // yyyy-mm-dd
}

export type AgbisSyncOrderService = {
  dosId: string | null
  tovId: string | null // price-catalog item id (tov_id)
  service: string
  code: string | null
  price: number | null // unit price (whole tenge)
  qty: number | null
  kfx: number | null
  discount: number | null // percent
  lineAmount: number | null // service kredit (whole tenge)
  statusId: number | null
  statusName: string | null
}

export type AgbisSyncOrder = {
  dorId: string
  docNum: string | null
  contrId: string
  amount: number | null // order kredit (whole tenge)
  debet: number | null // paid amount (whole tenge)
  dolg: number | null // outstanding debt (whole tenge)
  orderDate: string | null // yyyy-mm-dd (calendar, no timezone shift)
  dateOut: string | null // yyyy-mm-dd planned delivery date
  statusId: number | null
  statusName: string | null
  userId: string | null
  userName: string | null // Agbis employee who created the order
  discount: number | null
  services: AgbisSyncOrderService[] // Srvices[]
  products: AgbisSyncOrderService[] // Tovars[] — same item shape, flagged is_product on write
}

const StrNum = z.union([z.string(), z.number()])
const StrNumBool = z.union([z.string(), z.number(), z.boolean()])

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** String/number with a possible decimal comma → float, or null (qty/kfx/discount percent). */
function toNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s/g, '').replace(',', '.')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function toInt(value: unknown): number | null {
  const n = toNum(value)
  return n === null ? null : Math.trunc(n)
}

function toBool(value: unknown): boolean {
  return value === '1' || value === 1 || value === true
}

// ── Clients ────────────────────────────────────────────────────────────────

const RawClientSchema = z
  .object({
    contr_id: StrNum,
    fullname: z.string().optional(),
    name: z.string().optional(),
    telephone: z.string().optional(),
    teleph_cell: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    gender: StrNum.optional(),
    is_active: StrNumBool.optional(),
    is_deleted: StrNumBool.optional(),
    order_count: StrNum.optional(),
    bonus: StrNum.optional(),
    deposit: StrNum.optional(),
    dolg: StrNum.optional(),
    pay_summ: StrNum.optional(),
    first_order_date: z.string().optional(),
    last_order_date: z.string().optional(),
  })
  .passthrough()

export function mapSyncClient(raw: unknown): AgbisSyncClient | null {
  const parsed = RawClientSchema.safeParse(raw)
  if (!parsed.success) return null
  const c = parsed.data
  const contrId = String(c.contr_id).trim()
  if (contrId === '') return null
  return {
    contrId,
    fullname: str(c.fullname),
    name: str(c.name),
    telephone: str(c.telephone),
    telephCell: str(c.teleph_cell),
    email: str(c.email),
    address: str(c.address),
    gender: toInt(c.gender),
    isActive: c.is_active === undefined ? true : toBool(c.is_active),
    isDeleted: toBool(c.is_deleted),
    orderCount: toInt(c.order_count),
    bonus: money(c.bonus),
    deposit: money(c.deposit),
    dolg: money(c.dolg),
    paySumm: money(c.pay_summ),
    firstOrderDate: agbisDateToYmd(c.first_order_date),
    lastOrderDate: agbisDateToYmd(c.last_order_date),
  }
}

// ── Orders ─────────────────────────────────────────────────────────────────

const RawServiceSchema = z
  .object({
    dos_id: StrNum.optional(),
    tov_id: StrNum.optional(),
    service: z.string().optional(),
    code: z.string().optional(),
    price: StrNum.optional(),
    qty: StrNum.optional(),
    kfx: StrNum.optional(),
    discount: StrNum.optional(),
    kredit: StrNum.optional(),
    status_id: StrNum.optional(),
    status_name: z.string().optional(),
  })
  .passthrough()

function mapSyncOrderService(raw: unknown): AgbisSyncOrderService | null {
  const parsed = RawServiceSchema.safeParse(raw)
  if (!parsed.success) return null
  const s = parsed.data
  const service = str(s.service)
  if (service === null) return null // a line must name what was sold
  return {
    dosId: s.dos_id != null ? String(s.dos_id) : null,
    tovId: s.tov_id != null ? String(s.tov_id) : null,
    service,
    code: str(s.code),
    price: money(s.price),
    qty: toNum(s.qty),
    kfx: toNum(s.kfx),
    discount: toNum(s.discount),
    lineAmount: money(s.kredit),
    statusId: toInt(s.status_id),
    statusName: str(s.status_name),
  }
}

const RawProductSchema = z
  .object({
    dol_id: StrNum.optional(),
    tov_id: StrNum.optional(),
    tovar_name: z.string().optional(),
    barcode: z.string().optional(),
    price: StrNum.optional(),
    qty: StrNum.optional(),
    kfx: StrNum.optional(),
    discount: StrNum.optional(),
    kredit: StrNum.optional(),
  })
  .passthrough()

/** Tovars[] product line → same item shape as a service (flagged is_product on write). */
function mapSyncProduct(raw: unknown): AgbisSyncOrderService | null {
  const parsed = RawProductSchema.safeParse(raw)
  if (!parsed.success) return null
  const p = parsed.data
  const name = str(p.tovar_name)
  if (name === null) return null
  return {
    dosId: p.dol_id != null ? String(p.dol_id) : null,
    tovId: p.tov_id != null ? String(p.tov_id) : null,
    service: name,
    code: str(p.barcode),
    price: money(p.price),
    qty: toNum(p.qty),
    kfx: toNum(p.kfx),
    discount: toNum(p.discount),
    lineAmount: money(p.kredit),
    statusId: null,
    statusName: null,
  }
}

const RawOrderSchema = z
  .object({
    dor_id: StrNum,
    doc_num: StrNum.optional(),
    contr_id: StrNum,
    kredit: StrNum.optional(),
    debet: StrNum.optional(),
    dolg: StrNum.optional(),
    doc_date: z.string().optional(),
    date_out: z.string().optional(),
    status_id: StrNum.optional(),
    status: StrNum.optional(),
    status_name: z.string().optional(),
    user_id: StrNum.optional(),
    user_name: z.string().optional(),
    discount: StrNum.optional(),
    Srvices: z.array(z.unknown()).optional(),
    Tovars: z.array(z.unknown()).optional(),
  })
  .passthrough()

export function mapSyncOrder(raw: unknown): AgbisSyncOrder | null {
  const parsed = RawOrderSchema.safeParse(raw)
  if (!parsed.success) return null
  const o = parsed.data
  const dorId = String(o.dor_id).trim()
  const contrId = String(o.contr_id).trim()
  if (dorId === '' || contrId === '') return null
  const services = Array.isArray(o.Srvices)
    ? o.Srvices.map(mapSyncOrderService).filter((s): s is AgbisSyncOrderService => s !== null)
    : []
  const products = Array.isArray(o.Tovars)
    ? o.Tovars.map(mapSyncProduct).filter((p): p is AgbisSyncOrderService => p !== null)
    : []
  return {
    dorId,
    docNum: o.doc_num != null ? String(o.doc_num) : null,
    contrId,
    amount: money(o.kredit),
    debet: money(o.debet),
    dolg: money(o.dolg),
    orderDate: agbisDateToYmd(o.doc_date),
    dateOut: agbisDateToYmd(o.date_out),
    statusId: toInt(o.status_id ?? o.status), // header carries both; status_id is canonical
    statusName: str(o.status_name),
    userId: o.user_id != null ? String(o.user_id) : null,
    userName: str(o.user_name),
    discount: toNum(o.discount),
    services,
    products,
  }
}
