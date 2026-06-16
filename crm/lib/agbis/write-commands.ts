import { z } from 'zod'
import { agbisCall } from './client'
import { getValidSession } from './session'

/**
 * Agbis commercial WRITE commands (ContragForAll, SaveOrderForAll). Billed — see 06-tariffs.md.
 * Kept separate from commands.ts (read wrappers) to avoid cross-stream file collisions.
 * Pure body-builders + response-parsers are exported for unit tests; the orchestration
 * functions only add the session + HTTP call. Request JSON values are sent as strings
 * (matches Agbis examples). Generic errors bubble from agbisCall (R1).
 */

const StrNum = z.union([z.string(), z.number()])

// ── ContragForAll ──────────────────────────────────────────────────────────
export type ContragInput = {
  name: string
  fullname: string
  telephCell?: string | null
  address?: string | null
  contrId?: string | null // present → update existing contragent
}

export function buildContragBody(input: ContragInput): Record<string, string> {
  const body: Record<string, string> = { name: input.name, fullname: input.fullname }
  if (input.contrId) body.contr_id = input.contrId
  if (input.telephCell) body.teleph_cell = input.telephCell
  if (input.address) body.address = input.address
  return body
}

const ContragResponseSchema = z.object({ contr_id: StrNum, WasNew: StrNum.optional() })

export function parseContragResponse(res: unknown): { contrId: string; wasNew: boolean } {
  const parsed = ContragResponseSchema.safeParse(res)
  if (!parsed.success) throw new Error('Agbis: ответ ContragForAll без contr_id')
  return { contrId: String(parsed.data.contr_id), wasNew: String(parsed.data.WasNew ?? '') === '1' }
}

export async function contragForAll(input: ContragInput): Promise<{ contrId: string; wasNew: boolean }> {
  const sessionId = await getValidSession()
  const res = await agbisCall('ContragForAll', { method: 'POST', sessionId, body: buildContragBody(input) })
  return parseContragResponse(res)
}

// ── SaveOrderForAll ────────────────────────────────────────────────────────
export type SaveOrderService = { tovarId: string; count: number; discount?: number }

export type SaveOrderInput = {
  contrId: string
  scladId: string
  scladOutId: string
  priceId: string
  statusId: number
  docDate?: string // dd.mm.yyyy
  dateOut?: string | null // dd.mm.yyyy HH:MM:SS (planned issue date/time); omitted → none
  fastExec?: string | null // Agbis order_times id; only sent when truthy & non-zero
  createrId?: string | null // Agbis user_id of the manager (приёмщик); omitted → API user
  services: readonly SaveOrderService[]
}

type AgbisOrderHeader = Record<string, string>
type AgbisService = { dos_id: string; tovar_id: string; count: string; discount?: string; addons: [] }
type SaveOrderBody = { Order: AgbisOrderHeader; Services: AgbisService[]; Products: []; Comments: [] }

export function buildSaveOrderBody(input: SaveOrderInput): SaveOrderBody {
  const Order: AgbisOrderHeader = {
    contr_id: input.contrId,
    sclad_id: input.scladId,
    sclad_out_id: input.scladOutId,
    price_id: input.priceId,
    status_id: String(input.statusId),
  }
  if (input.docDate) Order.doc_date = input.docDate
  if (input.dateOut) Order.date_out = input.dateOut
  if (input.fastExec && input.fastExec !== '0') Order.fast_exec = input.fastExec
  if (input.createrId) Order.creater_id = input.createrId
  const Services = input.services.map((s, i) => {
    const svc: AgbisService = { dos_id: String(i + 1), tovar_id: s.tovarId, count: String(s.count), addons: [] }
    if (s.discount != null && s.discount > 0) svc.discount = String(s.discount)
    return svc
  })
  return { Order, Services, Products: [], Comments: [] }
}

const SaveOrderResponseSchema = z.object({ dor_id: StrNum })

export function parseSaveOrderResponse(res: unknown): { dorId: string } {
  const parsed = SaveOrderResponseSchema.safeParse(res)
  if (!parsed.success) throw new Error('Agbis: ответ SaveOrderForAll без dor_id')
  return { dorId: String(parsed.data.dor_id) }
}

export async function saveOrderForAll(input: SaveOrderInput): Promise<{ dorId: string }> {
  const sessionId = await getValidSession()
  const res = await agbisCall('SaveOrderForAll', { method: 'POST', sessionId, body: buildSaveOrderBody(input) })
  return parseSaveOrderResponse(res)
}
