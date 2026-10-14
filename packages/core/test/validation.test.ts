import { describe, expect, test } from 'bun:test'
import { decideModeration, type ReportForValidation } from '../src/validation.ts'

const t0 = new Date('2026-10-05T08:00:00Z')
const report = (over: Partial<ReportForValidation> = {}): ReportForValidation => ({
  id: 'new',
  schoolUai: '0750001A',
  status: 'blocked',
  origin: 'aggregator',
  observedAt: t0,
  sourceId: 'channel-a',
  sourceDomain: 't.me',
  moderation: 'pending',
  ...over,
})
const ctx = { sourceTrusted: false, domainTrusted: false, neighbours: [] }

describe('decideModeration', () => {
  test('a trusted domain or a trusted source publishes at once', () => {
    expect(decideModeration(report(), { ...ctx, domainTrusted: true })).toMatchObject({
      moderation: 'approved',
      reason: 'trusted_domain',
    })
    expect(decideModeration(report(), { ...ctx, sourceTrusted: true })).toMatchObject({
      moderation: 'approved',
      reason: 'trusted_source',
    })
  })

  test('a single untrusted source waits for moderation', () => {
    expect(decideModeration(report(), ctx).moderation).toBe('pending')
  })

  test('the same source twice is not a concordance', () => {
    const same = report({ id: 'old', observedAt: new Date(t0.getTime() - 3_600_000) })
    expect(decideModeration(report(), { ...ctx, neighbours: [same] }).moderation).toBe('pending')
  })

  test('another channel on the same domain agrees: both approved', () => {
    const other = report({ id: 'old', sourceId: 'channel-b' })
    expect(decideModeration(report(), { ...ctx, neighbours: [other] })).toEqual({
      moderation: 'approved',
      reason: 'concordant',
      promote: ['old'],
    })
  })

  test('a different status or outside the window does not agree', () => {
    const lifted = report({ id: 'a', sourceId: 'x', status: 'lifted' })
    const late = report({
      id: 'b',
      sourceId: 'y',
      observedAt: new Date(t0.getTime() + 3 * 3_600_000),
    })
    expect(decideModeration(report(), { ...ctx, neighbours: [lifted, late] }).moderation).toBe(
      'pending',
    )
    expect(
      decideModeration(report(), { ...ctx, neighbours: [late], windowHours: 4 }).moderation,
    ).toBe('approved')
  })

  test('on-site reports always go to moderation and never confirm others', () => {
    const onSite = report({ origin: 'on_site', sourceId: null, sourceDomain: null })
    expect(decideModeration(onSite, { ...ctx, domainTrusted: true }).moderation).toBe('pending')
    const fromUser = report({ id: 'u', origin: 'on_site', sourceId: null, sourceDomain: null })
    expect(decideModeration(report(), { ...ctx, neighbours: [fromUser] }).moderation).toBe(
      'pending',
    )
  })

  test('rejected reports never confirm', () => {
    const rejected = report({ id: 'r', sourceId: 'z', moderation: 'rejected' })
    expect(decideModeration(report(), { ...ctx, neighbours: [rejected] }).moderation).toBe(
      'pending',
    )
  })
})
