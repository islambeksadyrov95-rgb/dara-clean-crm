import { z } from 'zod'

export type Dictionary = {
  operationTypes: string[]
  paymentTypes: string[]
  categories: string[]
  articlesByCategory: Record<string, string[]>
  employees: string[]
}

export type EntryRow = {
  dateIso: string
  operationType: string
  paymentType: string
  category: string
  article: string
  employee?: string
  amount: number
  comment?: string
}

const dictionarySchema = z.object({
  operationTypes: z.array(z.string()),
  paymentTypes: z.array(z.string()),
  categories: z.array(z.string()),
  articlesByCategory: z.record(z.array(z.string())),
  employees: z.array(z.string())
})

const addEntryResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  rowNumber: z.number().int().optional()
})

const listEntriesResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  entries: z
    .array(
      z.object({
        dateIso: z.string(),
        operationType: z.string(),
        paymentType: z.string(),
        category: z.string(),
        article: z.string(),
        employee: z.string().optional(),
        amount: z.number(),
        comment: z.string().optional()
      })
    )
    .default([])
})

const monthStatsResponseSchema = z.object({
  ok: z.boolean(),
  month: z.string(),
  totalsByCategory: z.record(z.number()),
  total: z.number()
})

export type AddEntryPayload = {
  apiKey: string
  chatId: number
  userId: number
  username?: string
  createdAtIso: string
  dateIso: string
  operationType: string
  paymentType: string
  category: string
  article: string
  employee?: string
  amount: number
  comment?: string
}

const addEntryPayloadSchema: z.ZodType<AddEntryPayload> = z.object({
  apiKey: z.string().min(1),
  chatId: z.number().int(),
  userId: z.number().int(),
  username: z.string().optional(),
  createdAtIso: z.string().min(1),
  dateIso: z.string().min(1),
  operationType: z.string().min(1),
  paymentType: z.string().min(1),
  category: z.string().min(1),
  article: z.string().min(1),
  employee: z.string().optional(),
  amount: z.number().finite(),
  comment: z.string().optional()
})

export class AppsScriptClient {
  private readonly baseUrl: string
  private readonly apiKey: string

  public constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
  }

  private readonly postJson = async <T>(action: string, body: unknown, schema: z.ZodSchema<T>) => {
    const url = `${this.baseUrl}?action=${encodeURIComponent(action)}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

    const text = await response.text()
    const parsedJson = (() => {
      try {
        return JSON.parse(text)
      } catch {
        return { ok: false, message: text }
      }
    })()

    if (!response.ok) {
      const message = typeof parsedJson?.message === 'string' ? parsedJson.message : `HTTP ${response.status}`
      throw new Error(message)
    }

    return schema.parse(parsedJson)
  }

  public readonly getDictionary = async (): Promise<Dictionary> => {
    return await this.postJson('dict', { apiKey: this.apiKey }, dictionarySchema)
  }

  public readonly addEntry = async (payload: Omit<AddEntryPayload, 'apiKey'>) => {
    const validated = addEntryPayloadSchema.parse({ ...payload, apiKey: this.apiKey })
    return await this.postJson('entry.add', validated, addEntryResponseSchema)
  }

  public readonly listEntries = async (limit = 10) => {
    return await this.postJson('entry.list', { apiKey: this.apiKey, limit }, listEntriesResponseSchema)
  }

  public readonly monthStats = async (month: string) => {
    return await this.postJson('stats.month', { apiKey: this.apiKey, month }, monthStatsResponseSchema)
  }
}

