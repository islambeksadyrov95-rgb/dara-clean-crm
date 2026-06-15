import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildUrl, agbisCall, rawLogin, AgbisError, AgbisSessionExpiredError } from '@/lib/agbis/client'
import { resetAgbisConfigCache } from '@/lib/agbis/config'

const BASE = 'https://himinfo.org/cl/daraclean_838936e8/api'

function mockFetchOnce(json: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 400,
      status,
      json: async () => json,
    }),
  )
}

describe('Agbis client', () => {
  beforeEach(() => {
    process.env.AGBIS_API_BASE = BASE + '/'
    process.env.AGBIS_API_USER = 'Дарын'
    process.env.AGBIS_API_PWD = 'Daryn101998'
    resetAgbisConfigCache()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('buildUrl: single-encodes params, appends SessionID, handles no-param commands', () => {
    expect(buildUrl(BASE, 'PriceList', { price_id: '0' })).toBe(
      `${BASE}/?PriceList=${encodeURIComponent('{"price_id":"0"}')}`,
    )
    expect(buildUrl(BASE, 'Regions')).toBe(`${BASE}/?Regions`)
    expect(buildUrl(BASE, 'PriceList', { price_id: '0' }, 'SID-1')).toBe(
      `${BASE}/?PriceList=${encodeURIComponent('{"price_id":"0"}')}&SessionID=SID-1`,
    )
  })

  it('decodes response strings on success (error:0)', async () => {
    mockFetchOnce({ error: 0, name: '%D0%9A' })
    const res = await agbisCall('Regions')
    expect(res.name).toBe('К')
  })

  it('maps error:3 to AgbisSessionExpiredError', async () => {
    mockFetchOnce({ error: 3, Msg: 'expired' })
    await expect(agbisCall('Regions')).rejects.toBeInstanceOf(AgbisSessionExpiredError)
  })

  it('maps error:1 to AgbisError carrying Msg', async () => {
    mockFetchOnce({ error: 1, Msg: 'bad params' })
    await expect(agbisCall('Regions')).rejects.toMatchObject({ code: 1, message: 'bad params' })
  })

  it('rawLogin parses Session_id / Refresh_id / User_ID', async () => {
    mockFetchOnce({ error: 0, Session_id: 'S-1', Refresh_id: 'R-1', User_ID: '1022' })
    expect(await rawLogin()).toEqual({ sessionId: 'S-1', refreshId: 'R-1', userId: '1022' })
  })

  it('throws AgbisError on non-ok HTTP', async () => {
    mockFetchOnce({}, 500)
    await expect(agbisCall('Regions')).rejects.toBeInstanceOf(AgbisError)
  })
})
