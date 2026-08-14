/**
 * Pure DeepSeek pricing mathematics for the host fold. The only ambient
 * dependency is `Intl.DateTimeFormat` timezone formatting. The client
 * current-price display computes its own tier over the parsed schedule
 * snapshot in the display package; it never re-resolves a schedule here.
 *
 * @module @deepseek-ai/dsh-cost-meter/pricing
 */
import type { ModelPricingConfig, PricePeriod, PricingScheduleConfig, ResolvedUnitPrice, UnitPrice, UsageCostBucketTokens } from './types.ts';
/** Currency denominator: every configured rate is per one million tokens. */
export declare const PRICE_PER_MILLION = 1000000;
/** Host-resolved schedule: parsed peak ranges and an epoch cutoff, ready for O(1) per-sample pricing. */
export interface ResolvedPricingSchedule {
    currency: string;
    priceUnit: 'per_1M_tokens';
    timezone: string;
    effectiveFromMs: number;
    /** End-exclusive local minute-of-day intervals, e.g. `[540, 720)` for 09:00-12:00. */
    peakRanges: readonly (readonly [number, number])[];
    models: Readonly<Record<string, ModelPricingConfig>>;
}
/**
 * Validate and precompute one schedule. Failures throw at plugin load so a
 * misconfigured table never silently prices requests wrong.
 * @param config - the schema-validated schedule.
 * @returns the resolved schedule.
 */
export declare function resolveSchedule(config: PricingScheduleConfig): ResolvedPricingSchedule;
/**
 * Which tier applies to one instant: the flat pre-cutover tier, or the
 * post-cutover peak/off-peak tier selected by the schedule's local wall time.
 * @param schedule - resolved schedule.
 * @param timeMs - epoch milliseconds of the billed instant.
 * @returns the tier.
 */
export declare function periodAt(schedule: ResolvedPricingSchedule, timeMs: number): PricePeriod;
/**
 * Resolve one model's unit price at one instant.
 * @param schedule - resolved schedule.
 * @param modelId - the model id recorded by the request header.
 * @param timeMs - epoch milliseconds of the billed instant.
 * @returns the tier and price, or undefined for an unpriced model.
 */
export declare function resolveUnitPrice(schedule: ResolvedPricingSchedule, modelId: string, timeMs: number): ResolvedUnitPrice | undefined;
/**
 * Currency cost of three disjoint token buckets under one unit price.
 * @param buckets - cache-hit input, cache-miss input, and output tokens.
 * @param price - unit price per one million tokens.
 * @returns the cost in the schedule's currency.
 */
export declare function costOfUsage(buckets: UsageCostBucketTokens, price: UnitPrice): number;
//# sourceMappingURL=pricing.d.ts.map