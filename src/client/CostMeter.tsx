/**
 * Composer session-cost meter: an amount pill carrying the session total,
 * fed by the `usageCost` projection, with a click-open panel that shows the
 * per-model totals, token buckets, the live-rate table for the tier
 * currently in effect (resolved on the client clock, refreshed while the
 * panel is open), and the peak/off-peak cutover notice. The price table
 * prefers the official snapshot the host half serves and falls back to the
 * locally configured schedule; a successful official read is annotated with
 * its sync time. Renders nothing until the host cost-meter unit serves a
 * value; the panel mirrors the context meter's menu surface.
 */

import { useEffect, useRef, useState } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { PRICES_ENDPOINT, type OfficialPricing, type OfficialPricingResponse } from '../prices.ts'
import type { UsageCostProjection } from '../types.ts'
import {
  currencySymbol, formatClockMs, formatCost, formatModelName, formatModelShortName, formatPrice, formatTokens,
  parseEffectiveFrom, resolveTier,
} from './format.ts'
import { injectStyles, styles as css } from './styles.ts'

/** The component props: the framework standard kit plus the optional bar lock. */
export interface CostMeterViewProps {
  /** The key-addressed projection reader (the framework's fifth hook seat). */
  useProjection: UseProjection
  /** The `cost` namespace translate seat. */
  t: PropsLocale<'cost'>['t']
  /** The composer's chrome lock; the meter seat passes it, the dock does not. */
  locked?: boolean
}

/** How often an open panel re-resolves the price tier (client-clock tracking). */
const TIER_REFRESH_MS = 30_000

/** One bucket of the tier's official model price. */
type PriceBucket = 'inputCacheHit' | 'inputCacheMiss' | 'output'

/** The official snapshot the host half serves, once read. */
interface OfficialSnapshot {
  fetchedAt: number
  prices: OfficialPricing
}

/**
 * The session-cost meter over the host-computed `usageCost` projection.
 * Renders nothing while the capability is absent; otherwise shows a pill
 * badge whose click-open panel breaks the total down per priced model.
 */
export function CostMeter({ useProjection, t, locked = false }: CostMeterViewProps) {
  injectStyles()
  const cost = useProjection('usageCost') as UsageCostProjection | undefined
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  const [official, setOfficial] = useState<OfficialSnapshot | null>(null)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const available = cost !== undefined

  // A capability drop (host unit unmounted) closes the now-stale panel
  // instead of preserving it.
  useEffect(() => {
    if (!available && open) setOpen(false)
  }, [available, open])

  // The price tier rides the client clock: while the panel is open, tick
  // periodically so a peak interval or the cutover crossing re-resolves
  // without a click.
  useEffect(() => {
    if (!open || !available) return
    const timer = setInterval(() => { setTick(tick => tick + 1) }, TIER_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [available, open])

  // Read the official snapshot once per opening; an unavailable route or a
  // failed read leaves the locally configured schedule in place.
  useEffect(() => {
    if (!open || !available) return
    const controller = new AbortController()
    void fetch(PRICES_ENDPOINT, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null
        const body = await response.json() as OfficialPricingResponse
        return body.ok ? { fetchedAt: body.fetchedAt, prices: body.prices } : null
      })
      .then(value => setOfficial(value))
      .catch(() => setOfficial(null))
    return () => { controller.abort() }
  }, [available, open])

  // Outside click / Escape close, one document listener while open (the
  // context meter panel's pattern).
  useEffect(() => {
    if (!open || !available) return
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [available, open])

  if (cost === undefined) return null
  const amount = formatCost(cost.currency, cost.totalCost)
  const reading = `${t('dock.label')} ${amount}`
  const symbol = currencySymbol(cost.currency)
  // The official snapshot carries fresher cutover facts; the local schedule
  // is the fallback for every field.
  const effectiveSchedule = official?.prices ?? cost.schedule
  const tier = resolveTier(effectiveSchedule, Date.now())
  const cutover = parseEffectiveFrom(effectiveSchedule.effectiveFrom)
  const crossYear = cutover.year !== new Date().getFullYear()
  const effectiveKey = crossYear ? 'panel.effective.crossYear' : 'panel.effective'
  const effectiveArgs = crossYear
    ? { year: String(cutover.year), month: String(cutover.month), day: String(cutover.day) }
    : { month: String(cutover.month), day: String(cutover.day) }
  const effectiveTagKey = effectiveSchedule.effectiveFromMs > Date.now()
    ? 'panel.effective.tag.upcoming'
    : 'panel.effective.tag.active'
  const officialTier = official?.prices?.[tier]
  const priceOf = (model: string, bucket: PriceBucket): number =>
    officialTier?.[model]?.[bucket] ?? cost.schedule.models[model]?.[tier][bucket] ?? 0
  return (
    <span ref={rootRef} className={css.root}>
      <Tooltip label={reading} side="top" delayMs={200} disabled={open}>
        <button
          type="button"
          className={css.trigger}
          aria-label={reading}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={locked}
          onClick={() => { setOpen(!open) }}
        >
          {amount}
        </button>
      </Tooltip>
      {open && (
        <div className={css.panel} role="dialog" aria-label={t('panel.title')}>
          <div className={css.header}>
            <span className={css.title}>{t('panel.total')}</span>
            <span className={css.figures}>{formatCost(cost.currency, cost.totalCost)}</span>
          </div>
          {cost.models.length > 0 && (
            <dl className={css.models}>
              {cost.models.map(row => (
                <div key={row.model} className={css.model}>
                  <div className={css.modelRow}>
                    <dt className={css.modelName}>{formatModelName(row.model)}</dt>
                    <dd className={css.modelCost}>{formatCost(cost.currency, row.cost)}</dd>
                  </div>
                  <div className={css.tokens}>
                    <div className={css.tokenRow}>
                      <span>{t('panel.tokens.hit')}</span>
                      <span className={css.tokenValue}>{formatTokens(row.inputCacheHitTokens)}</span>
                    </div>
                    <div className={css.tokenRow}>
                      <span>{t('panel.tokens.miss')}</span>
                      <span className={css.tokenValue}>{formatTokens(row.inputCacheMissTokens)}</span>
                    </div>
                    <div className={css.tokenRow}>
                      <span>{t('panel.tokens.output')}</span>
                      <span className={css.tokenValue}>{formatTokens(row.outputTokens)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </dl>
          )}
          <div className={css.pricing}>
            <div className={css.pricingHeader}>
              <span className={css.pricingTitle}>{t('panel.pricing.title')}</span>
              {official !== null && (
                <span className={css.officialTag}>{t('panel.pricing.official', { time: formatClockMs(official.fetchedAt) })}</span>
              )}
            </div>
            <table className={css.table}>
              <thead>
                <tr>
                  <th>{t('panel.pricing.model')}</th>
                  <th>{t('panel.pricing.hit')}</th>
                  <th>{t('panel.pricing.miss')}</th>
                  <th>{t('panel.pricing.output')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(cost.schedule.models).map(([model]) => (
                  <tr key={model}>
                    <td className={css.tableModel}>{formatModelShortName(model)}</td>
                    <td className={css.num}>{`${symbol}${formatPrice(priceOf(model, 'inputCacheHit'))}`}</td>
                    <td className={css.num}>{`${symbol}${formatPrice(priceOf(model, 'inputCacheMiss'))}`}</td>
                    <td className={css.num}>{`${symbol}${formatPrice(priceOf(model, 'output'))}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={css.notice}>
            <span className={css.noticeText}>{t(effectiveKey, effectiveArgs)}</span>
            <span className={css.noticeTag}>{t(effectiveTagKey)}</span>
          </div>
        </div>
      )}
    </span>
  )
}
