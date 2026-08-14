/**
 * Pure DeepSeek pricing mathematics for the host fold. The only ambient
 * dependency is `Intl.DateTimeFormat` timezone formatting. The client
 * current-price display computes its own tier over the parsed schedule
 * snapshot in the display package; it never re-resolves a schedule here.
 *
 * @module dsh-cost-meter/pricing
 */

import type {
  ModelPricingConfig, PricePeriod, PricingScheduleConfig, ResolvedUnitPrice,
  UnitPrice, UsageCostBucketTokens,
} from './types.ts'

/** Currency denominator: every configured rate is per one million tokens. */
export const PRICE_PER_MILLION = 1_000_000

const PERIOD_PATTERN = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/
const MINUTES_PER_DAY = 24 * 60

/** Host-resolved schedule: parsed peak ranges and an epoch cutoff, ready for O(1) per-sample pricing. */
export interface ResolvedPricingSchedule {
  currency: string
  priceUnit: 'per_1M_tokens'
  timezone: string
  effectiveFromMs: number
  /** End-exclusive local minute-of-day intervals, e.g. `[540, 720)` for 09:00-12:00. */
  peakRanges: readonly (readonly [number, number])[]
  models: Readonly<Record<string, ModelPricingConfig>>
}

/**
 * Validate and precompute one schedule. Failures throw at plugin load so a
 * misconfigured table never silently prices requests wrong.
 * @param config - the schema-validated schedule.
 * @returns the resolved schedule.
 */
export function resolveSchedule(config: PricingScheduleConfig): ResolvedPricingSchedule {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }).format()
  } catch {
    throw new Error(`cost-meter: unknown timezone "${config.timezone}"`)
  }
  const effectiveFromMs = Date.parse(config.effectiveFrom)
  if (!Number.isFinite(effectiveFromMs)) {
    throw new Error(`cost-meter: effectiveFrom "${config.effectiveFrom}" is not a valid instant`)
  }
  return {
    currency: config.currency,
    priceUnit: config.priceUnit,
    timezone: config.timezone,
    effectiveFromMs,
    peakRanges: config.peakPeriods.map(parsePeriod),
    models: config.models,
  }
}

/**
 * Which tier applies to one instant: the flat pre-cutover tier, or the
 * post-cutover peak/off-peak tier selected by the schedule's local wall time.
 * @param schedule - resolved schedule.
 * @param timeMs - epoch milliseconds of the billed instant.
 * @returns the tier.
 */
export function periodAt(schedule: ResolvedPricingSchedule, timeMs: number): PricePeriod {
  if (timeMs < schedule.effectiveFromMs) return 'before'
  const minuteOfDay = wallMinuteOfDay(schedule.timezone, timeMs)
  return schedule.peakRanges.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end)
    ? 'peak'
    : 'offPeak'
}

/**
 * Resolve one model's unit price at one instant.
 * @param schedule - resolved schedule.
 * @param modelId - the model id recorded by the request header.
 * @param timeMs - epoch milliseconds of the billed instant.
 * @returns the tier and price, or undefined for an unpriced model.
 */
export function resolveUnitPrice(
  schedule: ResolvedPricingSchedule,
  modelId: string,
  timeMs: number,
): ResolvedUnitPrice | undefined {
  const model = schedule.models[modelId]
  if (model === undefined) return undefined
  const period = periodAt(schedule, timeMs)
  return { period, price: model[period] }
}

/**
 * Currency cost of three disjoint token buckets under one unit price.
 * @param buckets - cache-hit input, cache-miss input, and output tokens.
 * @param price - unit price per one million tokens.
 * @returns the cost in the schedule's currency.
 */
export function costOfUsage(buckets: UsageCostBucketTokens, price: UnitPrice): number {
  return (
    buckets.inputCacheHitTokens * price.inputCacheHit
    + buckets.inputCacheMissTokens * price.inputCacheMiss
    + buckets.outputTokens * price.output
  ) / PRICE_PER_MILLION
}

/** Parse one `HH:MM-HH:MM` interval into an end-exclusive minute-of-day range; 24:00 is a valid end. */
function parsePeriod(period: string): [number, number] {
  const match = PERIOD_PATTERN.exec(period)
  if (match === null) {
    throw new Error(`cost-meter: peak period "${period}" is not HH:MM-HH:MM`)
  }
  const startHour = Number(match[1])
  const startMinute = Number(match[2])
  const endHour = Number(match[3])
  const endMinute = Number(match[4])
  if (startHour >= 24 || endHour > 24 || startMinute >= 60 || endMinute >= 60
    || (endHour === 24 && endMinute !== 0)) {
    throw new Error(`cost-meter: peak period "${period}" has an out-of-range hour or minute`)
  }
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  if (start >= end || end > MINUTES_PER_DAY) {
    throw new Error(`cost-meter: peak period "${period}" must span a non-empty within-day interval`)
  }
  return [start, end]
}

/** Local wall-clock minute of day for one instant in the schedule's timezone. */
function wallMinuteOfDay(timeZone: string, timeMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(timeMs))
  let hour = 0
  let minute = 0
  for (const part of parts) {
    if (part.type === 'hour') hour = Number(part.value)
    else if (part.type === 'minute') minute = Number(part.value)
  }
  return hour * 60 + minute
}
