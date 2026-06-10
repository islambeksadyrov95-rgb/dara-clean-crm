import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Typed client for Beeline CloudPBX (VPBX) Web API.
 * Docs: https://cloudpbx.beeline.kz/VPBX/spec.json
 * Auth: integration token in header `X-VPBX-API-AUTH-TOKEN`.
 */

const DEFAULT_VPBX_URL = 'https://cloudpbx.beeline.kz/VPBX'
const APPLICATION_ID = 'DaraCleanCRM'
const SUBSCRIPTION_TTL_SECONDS = 86400 // 24h — max allowed by VPBX
const REQUEST_TIMEOUT_MS = 10000
const AUTH_HEADER = 'X-VPBX-API-AUTH-TOKEN'

export type VpbxConfig = {
  url: string
  token: string
  profileId: string
  webhookSecret: string
}

export type VpbxSubscription = {
  subscriptionId: string
  uri: string
  applicationId: string
  expiresSeconds?: number
  createdAt?: string
  expiresAt?: string
  status?: string
}

export type MakeCallResult = {
  uuid: string
  externalCallId: string | null
}

const VPBX_SETTING_KEYS = ['vpbx_url', 'vpbx_token', 'vpbx_profile_id', 'vpbx_webhook_secret'] as const

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/**
 * Reads VPBX config from crm_settings via the admin client.
 * Config is org-wide (not user specific), so admin read is correct here.
 */
export async function getVpbxConfig(): Promise<VpbxConfig> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('crm_settings')
    .select('key, value')
    .in('key', VPBX_SETTING_KEYS as unknown as string[])

  if (error) {
    throw new Error(`Не удалось прочитать настройки телефонии: ${error.message}`)
  }

  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    map[row.key as string] = asString((row as { value: unknown }).value)
  }

  return {
    url: (map.vpbx_url || process.env.BEELINE_VPBX_URL || DEFAULT_VPBX_URL).trim().replace(/\/+$/, ''),
    token: (map.vpbx_token || process.env.BEELINE_VPBX_TOKEN || '').trim(),
    profileId: (map.vpbx_profile_id || '').trim(),
    webhookSecret: (map.vpbx_webhook_secret || '').trim(),
  }
}

function ensureToken(config: VpbxConfig): void {
  if (!config.token) {
    throw new Error('Интеграция с телефонией не настроена: отсутствует токен АТС.')
  }
}

function ensureProfile(config: VpbxConfig): void {
  if (!config.profileId) {
    throw new Error('Не указан profileID компании в настройках телефонии.')
  }
}

async function vpbxFetch(
  config: VpbxConfig,
  path: string,
  params: Record<string, string | undefined>,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(`${config.url}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.append(key, value)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url.toString(), {
      ...init,
      headers: { [AUTH_HEADER]: config.token, ...(init?.headers ?? {}) },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text || response.statusText
  } catch {
    return response.statusText
  }
}

/**
 * Outgoing Click-to-Call from a company internal number.
 * VPBX first rings `abonentNumber`, then connects to `number`.
 */
export async function makeCall2(
  config: VpbxConfig,
  params: { abonentNumber: string; number: string; externalCallId?: string }
): Promise<MakeCallResult> {
  ensureToken(config)
  const response = await vpbxFetch(config, '/Api/MakeCall2', {
    abonentNumber: params.abonentNumber,
    number: params.number,
    externalCallId: params.externalCallId,
  }, { method: 'GET' })

  if (!response.ok) {
    throw new Error(`Ошибка АТС ${response.status}: ${await readError(response)}`)
  }

  let uuid = ''
  let externalCallId: string | null = params.externalCallId ?? null
  try {
    const data = (await response.json()) as { uuid?: string; externalCallId?: string }
    uuid = data.uuid ?? ''
    if (data.externalCallId) externalCallId = data.externalCallId
  } catch {
    // MakeCall (C2C) can return an empty body — uuid arrives via webhook instead
  }

  return { uuid, externalCallId }
}

/**
 * Creates/renews a company-level subscription to call events (VPBX-Events).
 * Idempotent on (profileID, uri, applicationId): same uri+app renews the TTL.
 */
export async function subscribe(
  config: VpbxConfig,
  webhookUri: string
): Promise<VpbxSubscription> {
  ensureToken(config)
  ensureProfile(config)

  const response = await vpbxFetch(config, '/Api/Subscribe', {
    profileID: config.profileId,
    uri: webhookUri,
    expires: String(SUBSCRIPTION_TTL_SECONDS),
    applicationId: APPLICATION_ID,
  }, { method: 'POST' })

  if (!response.ok) {
    throw new Error(`Не удалось создать подписку (${response.status}): ${await readError(response)}`)
  }

  return (await response.json()) as VpbxSubscription
}

/** Lists active subscriptions for the company profile. */
export async function getSubscriptions(config: VpbxConfig): Promise<VpbxSubscription[]> {
  ensureToken(config)
  ensureProfile(config)

  const response = await vpbxFetch(config, '/Api/GetSubscriptions', {
    profileID: config.profileId,
  }, { method: 'GET' })

  if (!response.ok) {
    throw new Error(`Не удалось получить подписки (${response.status}): ${await readError(response)}`)
  }

  const data = (await response.json()) as VpbxSubscription[] | null
  return Array.isArray(data) ? data : []
}

/** Deletes all subscriptions for the company profile. */
export async function deleteSubscriptions(config: VpbxConfig): Promise<void> {
  ensureToken(config)
  ensureProfile(config)

  const response = await vpbxFetch(config, '/Api/DeleteSubscription', {
    profileID: config.profileId,
  }, { method: 'DELETE' })

  if (!response.ok) {
    throw new Error(`Не удалось удалить подписку (${response.status}): ${await readError(response)}`)
  }
}

/**
 * Downloads a call recording. Returns the upstream Response so callers can
 * stream the body. `asPreview=true` streams inline; false downloads.
 */
export async function getRecordResponse(
  config: VpbxConfig,
  parentUUID: string,
  asPreview: boolean
): Promise<Response> {
  ensureToken(config)
  return vpbxFetch(config, '/Cloud/GetCallRecordContent', {
    parentUUID,
    asPreview: String(asPreview),
  }, { method: 'GET' })
}

/**
 * Builds the public webhook URL that VPBX posts events to.
 * The shared secret is carried in the `s` query param (VPBX has no auth header
 * for outbound webhooks), and verified by the webhook handler.
 */
export function getWebhookUrl(config: VpbxConfig): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://crm-roan-ten.vercel.app')
    .trim()
    .replace(/\/+$/, '')
  const url = new URL(`${base}/api/vpbx/webhook`)
  if (config.webhookSecret) url.searchParams.set('s', config.webhookSecret)
  return url.toString()
}

export { APPLICATION_ID, SUBSCRIPTION_TTL_SECONDS }
