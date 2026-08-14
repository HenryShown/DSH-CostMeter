/**
 * Pure pricing mathematics: cutover instant, peak/off-peak boundaries in the
 * schedule's timezone, model lookup, and the per-million-token cost formula.
 * Every instant is a fixed ISO string with an explicit +08:00 offset, so the
 * suite is independent of the host clock and timezone.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING, costOfUsage, resolveUnitPrice,
} from '../src/index.ts'
import { periodAt, resolveSchedule } from '../src/pricing.ts'

const at = (iso: string): number => Date.parse(iso)

const schedule = resolveSchedule(DEFAULT_PRICING)

describe('pricing schedule resolution', () => {
  it('resolves the shipped schedule into parsed peak ranges and the cutover instant', () => {
    expect(schedule.currency).toBe('CNY')
    expect(schedule.effectiveFromMs).toBe(at('2026-08-17T00:00:00+08:00'))
    expect(schedule.peakRanges).toEqual([[9 * 60, 12 * 60], [14 * 60, 18 * 60]])
  })

  it('rejects an unknown timezone, an invalid cutover, and malformed periods', () => {
    expect(() => resolveSchedule({ ...DEFAULT_PRICING, timezone: 'Not/AZone' }))
      .toThrow(/unknown timezone/)
    expect(() => resolveSchedule({ ...DEFAULT_PRICING, effectiveFrom: 'not-a-date' }))
      .toThrow(/not a valid instant/)
    expect(() => resolveSchedule({ ...DEFAULT_PRICING, peakPeriods: ['9:00-10:00'] }))
      .toThrow(/not HH:MM-HH:MM/)
    expect(() => resolveSchedule({ ...DEFAULT_PRICING, peakPeriods: ['09:00-09:00'] }))
      .toThrow(/non-empty within-day interval/)
    expect(() => resolveSchedule({ ...DEFAULT_PRICING, peakPeriods: ['24:01-24:02'] }))
      .toThrow(/out-of-range hour or minute/)
    expect(() => resolveSchedule({ ...DEFAULT_PRICING, peakPeriods: ['23:00-24:30'] }))
      .toThrow(/out-of-range hour or minute/)
  })
})

describe('periodAt', () => {
  it('uses the flat tier until the cutover instant and off-peak from the cutover itself', () => {
    expect(periodAt(schedule, at('2026-08-16T23:59:59.999+08:00'))).toBe('before')
    expect(periodAt(schedule, at('2026-08-17T00:00:00+08:00'))).toBe('offPeak')
  })

  it('selects peak inside the two intervals and off-peak everywhere else', () => {
    const cases: [string, 'peak' | 'offPeak'][] = [
      ['2026-08-18T08:59:59+08:00', 'offPeak'],
      ['2026-08-18T09:00:00+08:00', 'peak'],
      ['2026-08-18T11:59:59+08:00', 'peak'],
      ['2026-08-18T12:00:00+08:00', 'offPeak'],
      ['2026-08-18T13:59:59+08:00', 'offPeak'],
      ['2026-08-18T14:00:00+08:00', 'peak'],
      ['2026-08-18T17:59:59+08:00', 'peak'],
      ['2026-08-18T18:00:00+08:00', 'offPeak'],
      ['2026-08-18T23:59:59+08:00', 'offPeak'],
      ['2026-08-19T00:00:00+08:00', 'offPeak'],
    ]
    for (const [iso, expected] of cases) {
      expect(periodAt(schedule, at(iso)), iso).toBe(expected)
    }
  })
})

describe('resolveUnitPrice', () => {
  it('resolves each model tier and returns undefined for unpriced models', () => {
    expect(resolveUnitPrice(schedule, 'deepseek-v4-flash', at('2026-08-16T10:00:00+08:00')))
      .toEqual({ period: 'before', price: { inputCacheHit: 0.02, inputCacheMiss: 1.00, output: 2.00 } })
    expect(resolveUnitPrice(schedule, 'deepseek-v4-flash', at('2026-08-18T10:00:00+08:00')))
      .toEqual({ period: 'peak', price: { inputCacheHit: 0.10, inputCacheMiss: 3.00, output: 9.00 } })
    expect(resolveUnitPrice(schedule, 'deepseek-v4-pro', at('2026-08-18T03:00:00+08:00')))
      .toEqual({ period: 'offPeak', price: { inputCacheHit: 0.15, inputCacheMiss: 4.50, output: 13.50 } })
    expect(resolveUnitPrice(schedule, 'unknown-model', at('2026-08-18T03:00:00+08:00')))
      .toBeUndefined()
  })
})

describe('costOfUsage', () => {
  it('applies the per-million denominator to the three disjoint buckets', () => {
    expect(costOfUsage(
      { inputCacheHitTokens: 1_000_000, inputCacheMissTokens: 2_000_000, outputTokens: 1_000_000 },
      { inputCacheHit: 0.10, inputCacheMiss: 3.00, output: 9.00 },
    )).toBe(15.1)
  })

  it('returns zero for an empty sample', () => {
    expect(costOfUsage(
      { inputCacheHitTokens: 0, inputCacheMissTokens: 0, outputTokens: 0 },
      { inputCacheHit: 0.10, inputCacheMiss: 3.00, output: 9.00 },
    )).toBe(0)
  })
})
