/**
 * The `usageCost` projection unit: a pure fold of logged provider usage into
 * currency cost under the configured pricing schedule. The fold mirrors
 * dsh-token-meter's usage-sample replacement invariant, one final sample
 * per `(turn, step)`, so chunk usage and the assembled message's usage are
 * never double-counted. Each sample is priced at its own event time under
 * the model recorded by the newest `request/header`, so a model switch or a
 * schedule cutover reprices only later samples. A replacement credits the
 * superseded sample back to its own model's row before the new sample
 * lands, so a mid-step model switch moves the step's usage to the new
 * model instead of double counting it.
 *
 * @module dsh-cost-meter/projection
 */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import { type ResolvedPricingSchedule } from './pricing.ts';
import type { PricingScheduleConfig, UsageCostModel } from './types.ts';
/** The disjoint buckets one sample contributes, before currency pricing. */
interface UsageBuckets {
    inputCacheHitTokens: number;
    inputCacheMissTokens: number;
    outputTokens: number;
}
/** One priced sample; the `last` slot implements the per-`(turn, step)` replacement invariant. */
interface UsageSample {
    turn: number;
    step: number;
    model: string;
    buckets: UsageBuckets;
    cost: number;
}
/** Plain-JSON fold state per the projection unit contract. */
interface CostState {
    /** Insertion-ordered rows for models that logged at least one priced sample. */
    models: UsageCostModel[];
    last: UsageSample | null;
    currentModel: string | null;
}
/**
 * Build the `usageCost` unit for one resolved schedule.
 * @param schedule - the resolved pricing schedule.
 * @param raw - the raw schedule snapshot served verbatim to clients.
 * @returns the projection definition.
 */
export declare function usageCostProjectionDefinition(schedule: ResolvedPricingSchedule, raw: PricingScheduleConfig): ProjectionDefinition<'usageCost', CostState>;
export {};
