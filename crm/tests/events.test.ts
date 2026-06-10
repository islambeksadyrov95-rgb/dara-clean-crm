import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { VpbxEventSchema, buildCallUpsert, pickClientNumber } from '@/lib/vpbx/events'

const finishEvent = {
  type: 'CallFinishEvent',
  eventID: 'evt-1',
  companyId: '38',
  uuid: 'call-uuid-1',
  numberA: '+77001112233',
  numberB: '+77009998877',
  callType: 'OUTBOUND',
  externalCallId: 'crm-abc',
  callFinishedStatus: 'ANSWERED',
  isRecorded: true,
  recordUrl: 'https://cloudpbx.beeline.kz/VPBX/Cloud/GetCallRecordContent?parentUUID=call-uuid-1&token=jwt',
  duration: 42,
  isLast: true,
  date: 1700000025,
}

const startInboundEvent = {
  type: 'CallStartEvent',
  eventID: 'evt-2',
  uuid: 'call-uuid-2',
  numberA: '+77005554433',
  numberB: '+77770000000',
  lineNumber: '+77770000000',
  callType: 'INBOUND',
  isFirst: true,
  date: 1700000010,
}

describe('VpbxEventSchema', () => {
  it('accepts a finish event', () => {
    const parsed = VpbxEventSchema.safeParse(finishEvent)
    expect(parsed.success).toBe(true)
  })

  it('rejects an event without eventID', () => {
    const parsed = VpbxEventSchema.safeParse({ ...finishEvent, eventID: undefined })
    expect(parsed.success).toBe(false)
  })

  it('keeps unknown fields without throwing', () => {
    const parsed = VpbxEventSchema.safeParse({ ...finishEvent, somethingNew: 123 })
    expect(parsed.success).toBe(true)
  })
})

describe('pickClientNumber', () => {
  it('returns the callee for outbound calls', () => {
    expect(pickClientNumber(finishEvent)).toBe('+77009998877')
  })

  it('returns the caller for inbound calls', () => {
    expect(pickClientNumber(startInboundEvent)).toBe('+77005554433')
  })
})

describe('buildCallUpsert', () => {
  it('maps a finish event to a call patch and marks recorded calls pending', () => {
    const patch = buildCallUpsert(finishEvent)
    expect(patch.vpbx_uuid).toBe('call-uuid-1')
    expect(patch.external_call_id).toBe('crm-abc')
    expect(patch.direction).toBe('outbound')
    expect(patch.finish_status).toBe('ANSWERED')
    expect(patch.duration).toBe(42)
    expect(patch.is_recorded).toBe(true)
    expect(patch.record_url).toContain('parentUUID=call-uuid-1')
    expect(patch.transcription_status).toBe('pending')
    expect(patch.finished_at).toBe(new Date(1700000025 * 1000).toISOString())
  })

  it('does not mark transcription pending when not recorded', () => {
    const patch = buildCallUpsert({ ...finishEvent, isRecorded: false, recordUrl: undefined })
    expect(patch.is_recorded).toBe(false)
    expect(patch.transcription_status).toBeUndefined()
  })

  it('maps an inbound start event with line number and started_at', () => {
    const patch = buildCallUpsert(startInboundEvent)
    expect(patch.direction).toBe('inbound')
    expect(patch.line_number).toBe('+77770000000')
    expect(patch.started_at).toBe(new Date(1700000010 * 1000).toISOString())
    expect(patch.finish_status).toBeUndefined()
  })
})
