import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// lib/vpbx/client.ts imports 'server-only' (throws under node) — stub it.
vi.mock('server-only', () => ({}))

import { makeCall2, subscribe, getRecordResponse, type VpbxConfig } from '@/lib/vpbx/client'

const config: VpbxConfig = {
  url: 'https://cloudpbx.beeline.kz/VPBX',
  token: 'test-token-123',
  profileId: '38',
  webhookSecret: 'secret',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('makeCall2', () => {
  it('sends abonentNumber, number, externalCallId and the auth header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ uuid: 'call-uuid-1', externalCallId: 'crm-1' }))

    const result = await makeCall2(config, { abonentNumber: '101', number: '77001234567', externalCallId: 'crm-1' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0]
    const url = new URL(calledUrl as string)
    expect(url.pathname).toBe('/VPBX/Api/MakeCall2')
    expect(url.searchParams.get('abonentNumber')).toBe('101')
    expect(url.searchParams.get('number')).toBe('77001234567')
    expect(url.searchParams.get('externalCallId')).toBe('crm-1')
    expect((init as RequestInit).headers).toMatchObject({ 'X-VPBX-API-AUTH-TOKEN': 'test-token-123' })
    expect(result).toEqual({ uuid: 'call-uuid-1', externalCallId: 'crm-1' })
  })

  it('throws a non-leaking error on non-ok response', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 401 }))
    await expect(makeCall2(config, { abonentNumber: '101', number: '77001234567' })).rejects.toThrow(/401/)
  })

  it('throws when token is missing', async () => {
    await expect(
      makeCall2({ ...config, token: '' }, { abonentNumber: '101', number: '77001234567' })
    ).rejects.toThrow(/токен/i)
  })
})

describe('subscribe', () => {
  it('posts profileID, uri, expires and applicationId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ subscriptionId: 'sub-1', status: 'ACTIVE' }))

    const sub = await subscribe(config, 'https://crm.example.com/api/vpbx/webhook?s=secret')

    const [calledUrl, init] = fetchMock.mock.calls[0]
    const url = new URL(calledUrl as string)
    expect(url.pathname).toBe('/VPBX/Api/Subscribe')
    expect(url.searchParams.get('profileID')).toBe('38')
    expect(url.searchParams.get('uri')).toBe('https://crm.example.com/api/vpbx/webhook?s=secret')
    expect(url.searchParams.get('expires')).toBe('86400')
    expect(url.searchParams.get('applicationId')).toBe('DaraCleanCRM')
    expect((init as RequestInit).method).toBe('POST')
    expect(sub.subscriptionId).toBe('sub-1')
  })

  it('throws when profileID is missing', async () => {
    await expect(subscribe({ ...config, profileId: '' }, 'https://x/y')).rejects.toThrow(/profileID/i)
  })
})

describe('getRecordResponse', () => {
  it('requests the recording with parentUUID and asPreview', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))

    await getRecordResponse(config, 'call-uuid-1', true)

    const [calledUrl] = fetchMock.mock.calls[0]
    const url = new URL(calledUrl as string)
    expect(url.pathname).toBe('/VPBX/Cloud/GetCallRecordContent')
    expect(url.searchParams.get('parentUUID')).toBe('call-uuid-1')
    expect(url.searchParams.get('asPreview')).toBe('true')
  })
})
