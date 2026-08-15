// @vitest-environment jsdom
/**
 * CostMeter over the `usageCost` projection: nothing renders while the
 * capability is absent; with a value the meter shows an amount pill whose
 * click-open panel carries the session total, per-model totals with token
 * buckets, the live-rate table for the tier currently in effect, and the
 * peak/off-peak cutover notice with its status tag. The price table prefers
 * the official snapshot the host half serves and falls back to the local
 * schedule. Escape and outside clicks close the panel; the bar lock disables
 * the trigger; a capability drop closes the open panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { CostMeter, type CostMeterViewProps } from '../src/client/CostMeter.tsx'
import {
  currencySymbol, formatCost, formatModelName, formatModelShortName, formatPrice, formatTokens,
  parseEffectiveFrom, parseOffsetMinutes, resolveTier, wallClockMinuteOfDay,
} from '../src/client/format.ts'
import type { UsageCostProjection } from '../src/types.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  cleanup()
})

beforeEach(() => {
  // The price route reports no snapshot by default: every panel falls back
  // to the locally configured schedule unless a case stubs a snapshot.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
})

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: CostMeterViewProps['t'] = makeTranslate(zh, commonZh)

function setup(cost: UsageCostProjection | undefined, locked = false) {
  const store = createSnapshotStore<{ value: UsageCostProjection | undefined }>({ value: cost })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const props = { useProjection, locked, t } as unknown as CostMeterViewProps
  const view = render(<CostMeter {...props} />)
  return { store, view }
}

const tier = (inputCacheHit: number, inputCacheMiss: number, output: number) =>
  ({ inputCacheHit, inputCacheMiss, output })

const schedule = {
  currency: 'CNY',
  priceUnit: 'per_1M_tokens' as const,
  timezone: 'Asia/Shanghai',
  effectiveFrom: '2026-08-17T00:00:00+08:00',
  effectiveFromMs: 1786896000000,
  peakRanges: [[540, 720]] as [number, number][],
  models: {
    'deepseek-v4-flash': {
      before: tier(0.02, 1, 2),
      peak: tier(0.1, 3, 9),
      offPeak: tier(0.05, 1.5, 4.5),
    },
    'deepseek-v4-pro': {
      before: tier(0.025, 3, 6),
      peak: tier(0.3, 9, 27),
      offPeak: tier(0.15, 4.5, 13.5),
    },
  },
}

const value = (totalCost: number): UsageCostProjection => ({
  currency: 'CNY',
  totalCost,
  models: [
    { model: 'deepseek-v4-pro', cost: 0.703052, inputCacheHitTokens: 5302400, inputCacheMissTokens: 111318, outputTokens: 39423 },
    { model: 'deepseek-v4-flash', cost: 0.000017, inputCacheHitTokens: 0, inputCacheMissTokens: 3, outputTokens: 7 },
  ],
  schedule,
})

const trigger = () => screen.getByRole('button', { name: '费用 ¥0.7031' })
const panel = () => screen.queryByRole('dialog', { name: '会话费用' })

describe('cost formatting helpers', () => {
  it('gives the currency symbol prefix', () => {
    expect(currencySymbol('CNY')).toBe('¥')
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('EUR')).toBe('EUR ')
  })

  it('rounds amounts to four decimals with currency symbols', () => {
    expect(formatCost('CNY', 0.703052)).toBe('¥0.7031')
    expect(formatCost('CNY', 0.2)).toBe('¥0.2000')
    expect(formatCost('USD', 1.5)).toBe('$1.5000')
    expect(formatCost('EUR', 1.25)).toBe('EUR 1.2500')
  })

  it('abbreviates token counts as M / K / plain integers', () => {
    expect(formatTokens(5302400)).toBe('5.3M')
    expect(formatTokens(111318)).toBe('111K')
    expect(formatTokens(39423)).toBe('39.4K')
    expect(formatTokens(62630)).toBe('62.6K')
    expect(formatTokens(151318)).toBe('151K')
    expect(formatTokens(3)).toBe('3')
  })

  it('renders prices exactly as the schedule carries them', () => {
    expect(formatPrice(0.02)).toBe('0.02')
    expect(formatPrice(1)).toBe('1')
    expect(formatPrice(0.025)).toBe('0.025')
  })

  it('renders model ids as brand-prefixed display names and compact table names', () => {
    expect(formatModelName('deepseek-v4-flash')).toBe('DeepSeek-V4-Flash')
    expect(formatModelName('deepseek-v4-pro')).toBe('DeepSeek-V4-Pro')
    expect(formatModelName('v4-pro')).toBe('V4-Pro')
    expect(formatModelShortName('deepseek-v4-flash')).toBe('V4-Flash')
    expect(formatModelShortName('deepseek-v4-pro')).toBe('V4-Pro')
    expect(formatModelShortName('claude-sonnet-4')).toBe('Claude-Sonnet-4')
  })

  it('parses the ISO cutover into calendar parts and its trailing offset', () => {
    expect(parseEffectiveFrom('2026-08-17T00:00:00+08:00')).toEqual({ year: 2026, month: 8, day: 17 })
    expect(parseOffsetMinutes('2026-08-17T00:00:00+08:00')).toBe(480)
    expect(parseOffsetMinutes('2026-08-17T00:00:00-05:00')).toBe(-300)
    expect(parseOffsetMinutes('2026-08-17T00:00:00Z')).toBe(0)
  })

  it('reads the wall-clock minute in the configured timezone and falls back on a bad zone', () => {
    // 2026-08-20T01:30:00Z is 09:30 in Asia/Shanghai.
    expect(wallClockMinuteOfDay('Asia/Shanghai', 480, Date.parse('2026-08-20T01:30:00Z'))).toBe(570)
    expect(wallClockMinuteOfDay('Not/AZone', 480, Date.parse('2026-08-20T01:30:00Z'))).toBe(570)
  })

  it('resolves the tier in effect: flat before the cutover, then peak and off-peak', () => {
    const flat = { effectiveFrom: '2026-08-17T00:00:00+08:00', effectiveFromMs: 1786896000000, timezone: 'Asia/Shanghai', peakRanges: [[540, 720], [840, 1080]] as [number, number][] }
    expect(resolveTier(flat, 1786896000000 - 1)).toBe('before')
    // 09:30 and 15:00 local are inside the peak intervals.
    expect(resolveTier(flat, Date.parse('2026-08-20T01:30:00Z'))).toBe('peak')
    expect(resolveTier(flat, Date.parse('2026-08-20T07:00:00Z'))).toBe('peak')
    // 12:00 is the end-exclusive boundary; 12:30 and 04:00 are off-peak.
    expect(resolveTier(flat, Date.parse('2026-08-20T04:00:00Z'))).toBe('offPeak')
    expect(resolveTier(flat, Date.parse('2026-08-20T04:30:00Z'))).toBe('offPeak')
  })
})

describe('CostMeter', () => {
  it('renders nothing for an absent capability', () => {
    const { view } = setup(undefined)
    expect(view.container.innerHTML).toBe('')
  })

  it('renders the amount pill with the session total as its accessible name', () => {
    setup(value(0.703052))
    expect(trigger().textContent).toBe('¥0.7031')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the breakdown panel and closes it again', () => {
    setup(value(0.703052))
    fireEvent.click(trigger())
    const dialog = panel()
    expect(dialog).toBeTruthy()
    expect(dialog!.textContent).toContain('本会话费用')
    expect(dialog!.textContent).toContain('¥0.7031')
    expect(dialog!.textContent).toContain('DeepSeek-V4-Pro')
    expect(screen.getAllByText('输入 · 缓存命中')).toHaveLength(2)
    expect(screen.getAllByText('5.3M')).toHaveLength(1)
    expect(screen.getAllByText('输入 · 缓存未命中')).toHaveLength(2)
    expect(screen.getAllByText('111K')).toHaveLength(1)
    expect(screen.getAllByText('输出')).toHaveLength(3)
    expect(screen.getAllByText('39.4K')).toHaveLength(1)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(trigger())
    expect(panel()).toBeNull()
  })

  it('prefers the official snapshot from the price route and annotates the sync time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T01:30:00Z'))
    const fetchedAt = new Date(2026, 7, 15, 12, 34).getTime()
    const official = {
      ok: true as const,
      fetchedAt,
      prices: {
        // The official peak tier covers flash only: the pro row falls back
        // to the configured schedule's peak tier.
        peak: {
          'deepseek-v4-flash': { inputCacheHit: 9.99, inputCacheMiss: 8.88, output: 7.77 },
        },
        offPeak: {
          'deepseek-v4-flash': { inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5 },
          'deepseek-v4-pro': { inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 },
        },
        peakRanges: [[540, 720], [840, 1080]] as [number, number][],
        timezone: 'Asia/Shanghai',
        effectiveFrom: '2026-08-17T00:00:00+08:00',
        effectiveFromMs: 1786896000000,
      },
    }
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify(official), { status: 200, headers: { 'content-type': 'application/json' } })))
    setup(value(0.703052))
    fireEvent.click(trigger())
    // The mocked fetch resolves in a microtask; flush it under fake timers.
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('官方同步 12:34')).toBeTruthy()
    expect(screen.getAllByText('¥9.99')).toHaveLength(1)
    expect(screen.getAllByText('¥8.88')).toHaveLength(1)
    expect(screen.getAllByText('¥7.77')).toHaveLength(1)
    // The pro row fell back to the configured peak tier.
    expect(screen.getAllByText('¥0.3')).toHaveLength(1)
  })

  it('falls back to the local schedule when the price route read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    setup(value(0.703052))
    fireEvent.click(trigger())
    await act(async () => {})
    expect(screen.queryByText(/官方同步/)).toBeNull()
    expect(panel()!.textContent).toContain('¥0.02')
  })

  it('shows the pre-cutover price table and the cutover notice with its status tag', () => {
    setup(value(0.703052))
    fireEvent.click(trigger())
    const dialog = panel()!
    expect(dialog.textContent).toContain('实时费率/1M tokens')
    expect(screen.getAllByText('缓存命中')).toHaveLength(1)
    expect(screen.getAllByText('未命中')).toHaveLength(1)
    // The branded name in the model-total section, the compact name in the
    // price table.
    expect(screen.getAllByText('V4-Flash')).toHaveLength(1)
    expect(screen.getAllByText('V4-Pro')).toHaveLength(1)
    expect(screen.getAllByText('¥0.02')).toHaveLength(1)
    expect(screen.getAllByText('¥0.025')).toHaveLength(1)
    expect(dialog.textContent).toContain('◷ 8 月 17 日起启用峰谷计价')
    expect(dialog.textContent).toContain('即将生效')
  })

  it('shows the price table for the tier in effect and follows the clock while open', () => {
    vi.useFakeTimers()
    // 09:30 Asia/Shanghai on a day after the cutover → peak tier.
    vi.setSystemTime(new Date('2026-08-20T01:30:00Z'))
    setup(value(0.703052))
    fireEvent.click(trigger())
    expect(screen.getAllByText('¥0.1')).toHaveLength(1)
    expect(screen.getAllByText('¥0.3')).toHaveLength(1)

    // Cross into 12:30 local (off-peak); the open panel re-resolves on its
    // 30s tick without a click.
    act(() => { vi.setSystemTime(new Date('2026-08-20T04:30:00Z')) })
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getAllByText('¥0.05')).toHaveLength(1)
    expect(screen.getAllByText('¥0.15')).toHaveLength(1)
  })

  it('tags the cutover as active once it passed and names the year across years', () => {
    const past = { ...value(0.703052), schedule: { ...schedule, effectiveFromMs: 1000 } }
    const { view } = setup(past)
    fireEvent.click(trigger())
    expect(view.getByText('已生效')).toBeTruthy()
    cleanup()

    const nextYear = {
      ...value(0.703052),
      schedule: { ...schedule, effectiveFrom: '2027-08-17T00:00:00+08:00' },
    }
    const live = setup(nextYear)
    fireEvent.click(trigger())
    expect(live.view.getByText('◷ 2027 年 8 月 17 日起启用峰谷计价')).toBeTruthy()
  })

  it('renders a panel without model rows when no model is priced', () => {
    setup({ ...value(0), models: [] })
    fireEvent.click(screen.getByRole('button', { name: '费用 ¥0.0000' }))
    const dialog = panel()
    expect(dialog).toBeTruthy()
    expect(dialog!.querySelector('dl')).toBeNull()
    expect(dialog!.textContent).toContain('¥0.0000')
    expect(dialog!.textContent).toContain('实时费率/1M tokens')
  })

  it('closes on Escape and on an outside pointerdown, keeping it open for an inside one', () => {
    setup(value(0.703052))
    fireEvent.click(trigger())
    expect(panel()).toBeTruthy()
    fireEvent.pointerDown(trigger())
    expect(panel()).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(panel()).toBeNull()

    fireEvent.click(trigger())
    expect(panel()).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(panel()).toBeNull()
  })

  it('closes the open panel when the capability drops', () => {
    const { store } = setup(value(0.703052))
    fireEvent.click(trigger())
    expect(panel()).toBeTruthy()
    act(() => { store.set({ value: undefined }) })
    expect(panel()).toBeNull()
  })

  it('disables the trigger under the bar lock', () => {
    setup(value(0.703052), true)
    const button = trigger()
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(panel()).toBeNull()
  })
})
