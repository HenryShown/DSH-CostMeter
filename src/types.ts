/**
 * Pure types of the cost-meter domain: the ONE home of the `usageCost`
 * projection-key declaration and the pricing vocabulary, free of this
 * package's host-side value imports (cordis context, zod). Two namespace
 * projections serve it: `./client` for client aggregates, `./src/*` for
 * host consumers and tests, with zero content duplication.
 *
 * @module dsh-cost-meter/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/** Currency price of one bucket, in {@link PricingScheduleConfig.currency} per one million tokens. */
export interface UnitPrice {
  inputCacheHit: number
  inputCacheMiss: number
  output: number
}

/** One model's three rate tiers: the flat pre-cutover tier and the post-cutover peak/off-peak tiers. */
export interface ModelPricingConfig {
  before: UnitPrice
  peak: UnitPrice
  offPeak: UnitPrice
}

/**
 * Deployment pricing table. Rates are per one million tokens; the schedule
 * switches from the flat `before` tier to peak/off-peak tiers at
 * {@link effectiveFrom} in {@link timezone}, where {@link peakPeriods} names
 * the peak local-time intervals (`HH:MM-HH:MM`, end-exclusive).
 */
export interface PricingScheduleConfig {
  currency: string
  priceUnit: 'per_1M_tokens'
  timezone: string
  effectiveFrom: string
  peakPeriods: readonly string[]
  models: Record<string, ModelPricingConfig>
}

/** The official-price feed half of the plugin configuration; every field defaults. */
export interface PricingFeedConfig {
  /** The official pricing page URL the host half scrapes. */
  pricingUrl?: string
  /** Refresh interval in milliseconds. */
  refreshIntervalMs?: number
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs?: number
}

/** The cost-meter plugin configuration; every field defaults to the shipped DeepSeek V4 schedule. */
export type CostMeterConfig = PricingScheduleConfig & PricingFeedConfig

/** Which rate tier applies to one instant. */
export type PricePeriod = 'before' | 'peak' | 'offPeak'

/** The tier and its unit price resolved for one model at one instant. */
export interface ResolvedUnitPrice {
  period: PricePeriod
  price: UnitPrice
}

/** The three disjoint billing buckets one cost figure is folded from. */
export interface UsageCostBucketTokens {
  inputCacheHitTokens: number
  inputCacheMissTokens: number
  outputTokens: number
}

/** Accumulated cost and bucket tokens for one priced model. */
export interface UsageCostModel extends UsageCostBucketTokens {
  model: string
  cost: number
}

/**
 * Client-facing schedule snapshot carried by the projection: the host has
 * already parsed {@link PricingScheduleConfig.peakPeriods} into
 * {@link peakRanges} and computed the {@link effectiveFromMs} cutoff, so a
 * client display only decides the wall-clock tier, never reparses the
 * schedule syntax.
 */
export interface UsageCostSchedule {
  currency: string
  priceUnit: 'per_1M_tokens'
  timezone: string
  effectiveFrom: string
  effectiveFromMs: number
  /** End-exclusive local minute-of-day intervals, e.g. `[540, 720)` for 09:00-12:00. */
  peakRanges: readonly (readonly [number, number])[]
  models: Record<string, ModelPricingConfig>
}

/**
 * Whole-log cost figures plus the effective schedule snapshot. `models`
 * contains only models that logged a priced usage sample; unknown or
 * unpriced models contribute nothing. The client reads `schedule` to show
 * the current tier's unit price at display time.
 */
export interface UsageCostProjection {
  currency: string
  totalCost: number
  models: UsageCostModel[]
  schedule: UsageCostSchedule
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log currency cost of provider usage; see {@link UsageCostProjection}. */
    usageCost: UsageCostProjection
  }
}
