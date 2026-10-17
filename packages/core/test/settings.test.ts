import { describe, expect, test } from 'bun:test'
import { isValidSetting, publicSettings, readSettings } from '../src/settings.ts'

describe('settings', () => {
  test('defaults when nothing is stored', () => {
    expect(readSettings([])).toEqual({
      status_ttl_hours: 5,
      movement_start: '2026-09-14',
      judge_tiers: false,
      movements_public: false,
      judge_keep: 0.5,
      judge_low: 0.3,
      media_analysis: true,
      route_detection: false,
      concordance_window_hours: 2,
    })
  })

  test('stored values win, invalid ones and unknown keys are ignored', () => {
    const s = readSettings([
      { key: 'status_ttl_hours', value: 10 },
      { key: 'judge_tiers', value: true },
      { key: 'judge_low', value: 2 },
      { key: 'movement_start', value: 'yesterday' },
      { key: 'unknown', value: 1 },
    ])
    expect(s.status_ttl_hours).toBe(10)
    expect(s.judge_tiers).toBe(true)
    expect(s.judge_low).toBe(0.3)
    expect(s.movement_start).toBe('2026-09-14')
  })

  test('the Mouvements pages are hidden until the setting is switched on', () => {
    expect(readSettings([]).movements_public).toBe(false)
    expect(publicSettings(readSettings([{ key: 'movements_public', value: true }]))).toMatchObject({
      movements_public: true,
    })
    // A stored value of the wrong type falls back to hidden.
    expect(readSettings([{ key: 'movements_public', value: 'yes' }]).movements_public).toBe(false)
  })

  test('validation and the public subset', () => {
    expect(isValidSetting('status_ttl_hours', 0)).toBe(false)
    expect(isValidSetting('movement_start', '2026-09-14')).toBe(true)
    expect(Object.keys(publicSettings(readSettings([])))).toEqual([
      'status_ttl_hours',
      'movement_start',
      'judge_tiers',
      'movements_public',
    ])
  })
})
