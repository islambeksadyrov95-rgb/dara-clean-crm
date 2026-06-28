import { getAgbisConfig } from './config'
import { enc, decodeAll } from './helpers'

/**
 * Low-level Agbis API HTTP client. No session storage here (see session.ts) — these
 * functions take an explicit sessionId, so session.ts can import this without a cycle.
 * Server-only by usage (env secrets + node) — never import from a client component.
 */

const TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 3
const MAX_BACKOFF_MS = 8_000

export type AgbisResponse = Record<string, unknown>

export class AgbisError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = 'AgbisError'
    this.code = code
  }
}

/** error:3 — пользовательская сессия просрочена → caller refreshes and retries. */
export class AgbisSessionExpiredError extends AgbisError {
  constructor() {
    super(3, 'Agbis: сессия просрочена')
    this.name = 'AgbisSessionExpiredError'
  }
}

/**
 * Наш таймаут (AbortController), а НЕ ошибка Агбиса. Без этого прерванный fetch всплывал
 * как DOMException с name='AbortError' и legacy `.code === 20` (ABORT_ERR), который выше
 * ошибочно подписывался `agbis_error_20` — отсюда родилась ложная версия «ковёр без оценки».
 * code=408 — честный «таймаут запроса»; вызывающий помечает заказ reason='agbis_timeout'.
 */
export class AgbisTimeoutError extends AgbisError {
  constructor(timeoutMs: number) {
    super(408, `Agbis: таймаут запроса (${timeoutMs}мс)`)
    this.name = 'AgbisTimeoutError'
  }
}

export type LoginResult = { sessionId: string; refreshId: string; userId: string | null }

export type CallOptions = {
  params?: Record<string, unknown>
  sessionId?: string
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  timeoutMs?: number // override for heavy *ByDateTimeForAll sync POSTs (default TIMEOUT_MS)
}

/** Builds `${base}/?Command[={enc(params)}][&SessionID=...]`. */
export function buildUrl(
  base: string,
  command: string,
  params?: Record<string, unknown>,
  sessionId?: string,
): string {
  let query = command
  if (params) query += `=${enc(params)}`
  if (sessionId) query += `&SessionID=${encodeURIComponent(sessionId)}`
  return `${base}/?${query}`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS)
  return base + Math.floor(Math.random() * base * 0.1)
}

async function fetchAgbis(
  url: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<AgbisResponse> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: controller.signal })
    } catch (err) {
      // Прервал наш таймер → это таймаут, а не «Agbis error 20». Иначе abort'нутый fetch
      // бросает DOMException(code=20) и выше получает ложный ярлык agbis_error_20.
      if (controller.signal.aborted) throw new AgbisTimeoutError(timeoutMs)
      throw err
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 429) {
      if (attempt === MAX_ATTEMPTS) throw new AgbisError(429, 'Agbis: слишком много запросов')
      await sleep(backoffMs(attempt))
      continue
    }
    if (!response.ok) throw new AgbisError(response.status, `Agbis HTTP ${response.status}`)

    const json = (await response.json()) as AgbisResponse
    return decodeAll(json)
  }
  throw new AgbisError(0, 'Agbis: запрос не выполнен')
}

function checkError(res: AgbisResponse): AgbisResponse {
  const code = Number(res.error ?? 0)
  if (code === 0) return res
  if (code === 3) throw new AgbisSessionExpiredError()
  const message = typeof res.Msg === 'string' && res.Msg ? res.Msg : `Agbis error ${code}`
  throw new AgbisError(code, message)
}

/** Generic command call. GET (query string) by default; POST with `{[command]:body,SessionID}`. */
export async function agbisCall(command: string, opts: CallOptions = {}): Promise<AgbisResponse> {
  const { base } = getAgbisConfig()

  if (opts.method === 'POST') {
    const res = await fetchAgbis(
      `${base}/?${command}`,
      {
        method: 'POST',
        headers: { 'Content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ [command]: opts.body ?? {}, SessionID: opts.sessionId }),
      },
      opts.timeoutMs,
    )
    return checkError(res)
  }

  const res = await fetchAgbis(
    buildUrl(base, command, opts.params, opts.sessionId),
    undefined,
    opts.timeoutMs,
  )
  return checkError(res)
}

function toLoginResult(res: AgbisResponse): LoginResult {
  const { Session_id: sessionId, Refresh_id: refreshId, User_ID: userId } = res
  if (typeof sessionId !== 'string' || typeof refreshId !== 'string') {
    throw new AgbisError(1, 'Agbis: ответ авторизации без Session_id/Refresh_id')
  }
  return { sessionId, refreshId, userId: typeof userId === 'string' ? userId : null }
}

/** Login as the Agbis program user (cyrillic name + SHA-1 pwd + AsUser=1). */
export async function rawLogin(): Promise<LoginResult> {
  const { user, pwdSha1 } = getAgbisConfig()
  const res = await agbisCall('Login', { params: { User: user, Pwd: pwdSha1, AsUser: '1' } })
  return toLoginResult(res)
}

/** Renew the user session without re-auth. Note: input key is `Refresh_ID` (Login returns `Refresh_id`). */
export async function rawRefresh(refreshId: string): Promise<LoginResult> {
  const res = await agbisCall('RefreshSession', { params: { Refresh_ID: refreshId } })
  return toLoginResult(res)
}
