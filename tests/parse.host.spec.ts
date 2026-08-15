/**
 * The official pricing page parser over the recorded page fixture: every
 * peak/off-peak bucket for both shipped models, the peak intervals, and the
 * cutover must resolve; only the flat tier is optional. A page with malformed
 * required data yields null (the caller keeps its last good snapshot).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseOfficialPricing } from '../src/parse.ts'

const fixture = (): string =>
  readFileSync(fileURLToPath(new URL('./fixtures/pricing-page.html', import.meta.url)), 'utf8')

const minimalPage = (): string => [
  'deepseek-v4-flash 空闲时段 0.05 元 1.5 元 4.5 元 高峰时段 0.10 元 3.0 元 9.0 元',
  'deepseek-v4-pro 空闲时段 0.15 元 4.5 元 13.5 元 高峰时段 0.30 元 9.0 元 27.0 元',
  '高峰时段为北京时间 9:00 - 12:00、14:00 - 18:00。',
  '新价格将于北京时间 2026 年 8 月 17 日 00:00 开始生效',
].join(' ')

describe('parseOfficialPricing', () => {
  it('parses the recorded page into every tier, the peak intervals, and the cutover', () => {
    const prices = parseOfficialPricing(fixture())
    expect(prices).not.toBeNull()
    expect(prices!.before).toEqual({
      'deepseek-v4-flash': { inputCacheHit: 0.02, inputCacheMiss: 1, output: 2 },
      'deepseek-v4-pro': { inputCacheHit: 0.025, inputCacheMiss: 3, output: 6 },
    })
    expect(prices!.offPeak).toEqual({
      'deepseek-v4-flash': { inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5 },
      'deepseek-v4-pro': { inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 },
    })
    expect(prices!.peak).toEqual({
      'deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 },
      'deepseek-v4-pro': { inputCacheHit: 0.3, inputCacheMiss: 9, output: 27 },
    })
    expect(prices!.peakRanges).toEqual([[540, 720], [840, 1080]])
    expect(prices!.timezone).toBe('Asia/Shanghai')
    expect(prices!.effectiveFrom).toBe('2026-08-17T00:00:00+08:00')
    expect(prices!.effectiveFromMs).toBe(Date.parse('2026-08-17T00:00:00+08:00'))
  })

  it('returns null when a shipped model row is missing', () => {
    const html = fixture().replaceAll('deepseek-v4-pro', 'deepseek-v4-missing')
    expect(parseOfficialPricing(html)).toBeNull()
  })

  it('returns null when the cutover sentence is missing', () => {
    const html = fixture().replace(/2026 年 8 月 17 日 00:00/, '某年某月某日')
    expect(parseOfficialPricing(html)).toBeNull()
  })

  it('keeps the snapshot valid once the page drops the flat tier table', () => {
    const prices = parseOfficialPricing(minimalPage())
    expect(prices).not.toBeNull()
    expect(prices!.before).toBeUndefined()
    expect(prices!.peak).toEqual({
      'deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 },
      'deepseek-v4-pro': { inputCacheHit: 0.3, inputCacheMiss: 9, output: 27 },
    })
  })

  it('rejects malformed or non-finite required prices', () => {
    const huge = '9'.repeat(400)
    expect(parseOfficialPricing(minimalPage().replace('0.05 元', '1..5 元'))).toBeNull()
    expect(parseOfficialPricing(minimalPage().replace('0.05 元', '. 元'))).toBeNull()
    expect(parseOfficialPricing(minimalPage().replace('0.05 元', `${huge} 元`))).toBeNull()
  })

  it('rejects invalid peak intervals and accepts 24:00 only as an end', () => {
    expect(parseOfficialPricing(minimalPage().replace('9:00 - 12:00', '25:00 - 26:00'))).toBeNull()
    expect(parseOfficialPricing(minimalPage().replace('9:00 - 12:00', '9:60 - 12:00'))).toBeNull()
    expect(parseOfficialPricing(minimalPage().replace('9:00 - 12:00', '18:00 - 9:00'))).toBeNull()
    const valid = parseOfficialPricing(minimalPage().replace('14:00 - 18:00', '23:00 - 24:00'))
    expect(valid?.peakRanges).toEqual([[540, 720], [1380, 1440]])
  })

  it('rejects an impossible cutover date', () => {
    expect(parseOfficialPricing(minimalPage().replace('2026 年 8 月 17 日', '2026 年 2 月 30 日'))).toBeNull()
  })
})
