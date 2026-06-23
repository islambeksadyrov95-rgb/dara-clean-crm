import { describe, it, expect } from 'vitest'
import { WAZZUP_CHANNELS } from './config'

// Значения сверены с боевым Wazzup API (GET /v3/channels) 2026-06-23:
//   аккаунт 1 (WAZZUP_API_KEY)   → channelId dca799b9-… / plainId 77057618170 (+7 705 761-81-70)
//   аккаунт 2 (WAZZUP_API_KEY_2) → channelId fa03f183-… / plainId 77078083636 (+7 707 808-36-36)
// Тест фиксирует реальные channelId, чтобы конфиг не «уехал» обратно на фантомный канал.
describe('wazzup/config — карта каналов', () => {
  it('ровно два канала', () => {
    expect(WAZZUP_CHANNELS).toHaveLength(2)
  })

  it('канал[0] = аккаунт 1, +7 705 761-81-70, реальный channelId', () => {
    expect(WAZZUP_CHANNELS[0]).toEqual({
      id: 'dca799b9-49e4-4547-bf0c-c29f4597ec70',
      plainId: '77057618170',
      label: '+7 (705) 761-81-70',
    })
  })

  it('канал[1] = аккаунт 2, +7 707 808-36-36, реальный channelId', () => {
    expect(WAZZUP_CHANNELS[1]).toEqual({
      id: 'fa03f183-34e8-4c03-a1bb-c97cedbc6666',
      plainId: '77078083636',
      label: '+7 (707) 808-36-36',
    })
  })

  it('channelId уникальны — иначе getWazzupKeyForChannel перепутает ключи аккаунтов', () => {
    expect(WAZZUP_CHANNELS[0].id).not.toBe(WAZZUP_CHANNELS[1].id)
  })
})
