/**
 * Function plugin registering the `usageCost` projection unit: whole-log
 * currency cost of provider usage, priced per sample at its own event time
 * under the configured DeepSeek schedule. The plugin owns only the fold and
 * the pricing table; delivery is the session-projection seam's.
 *
 * @module @deepseek-ai/dsh-cost-meter
 */
import z from '@deepseek-ai/schemastery';
import { resolveSchedule } from "./pricing.js";
import { usageCostProjectionDefinition } from "./projection.js";
export { PRICE_PER_MILLION, costOfUsage, resolveUnitPrice } from "./pricing.js";
/** Cordis plugin name. */
export const name = 'cost-meter';
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections'];
const unitPriceSchema = z.object({
    inputCacheHit: z.number().min(0),
    inputCacheMiss: z.number().min(0),
    output: z.number().min(0),
});
const modelPricingSchema = z.object({
    before: unitPriceSchema,
    peak: unitPriceSchema,
    offPeak: unitPriceSchema,
});
const periodStringSchema = z.string().pattern(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
/**
 * The shipped DeepSeek V4 schedule: flat rates before 2026-08-17 00:00
 * (Asia/Shanghai), then peak rates 09:00-12:00 and 14:00-18:00 with
 * off-peak rates half the peak rates outside those intervals. Rates are CNY
 * per one million tokens; every value is overridable from cordis.yml.
 */
export const DEFAULT_PRICING = {
    currency: 'CNY',
    priceUnit: 'per_1M_tokens',
    timezone: 'Asia/Shanghai',
    effectiveFrom: '2026-08-17T00:00:00+08:00',
    peakPeriods: ['09:00-12:00', '14:00-18:00'],
    models: {
        'deepseek-v4-flash': {
            before: { inputCacheHit: 0.02, inputCacheMiss: 1.00, output: 2.00 },
            peak: { inputCacheHit: 0.10, inputCacheMiss: 3.00, output: 9.00 },
            offPeak: { inputCacheHit: 0.05, inputCacheMiss: 1.50, output: 4.50 },
        },
        'deepseek-v4-pro': {
            before: { inputCacheHit: 0.025, inputCacheMiss: 3.00, output: 6.00 },
            peak: { inputCacheHit: 0.30, inputCacheMiss: 9.00, output: 27.00 },
            offPeak: { inputCacheHit: 0.15, inputCacheMiss: 4.50, output: 13.50 },
        },
    },
};
/** Runtime schema for {@link CostMeterConfig}; unknown keys are rejected by {@link validateConfig}. */
export const Config = z.object({
    currency: z.string().min(1).default(DEFAULT_PRICING.currency),
    priceUnit: z.const('per_1M_tokens').default(DEFAULT_PRICING.priceUnit),
    timezone: z.string().min(1).default(DEFAULT_PRICING.timezone),
    effectiveFrom: z.string().min(1).default(DEFAULT_PRICING.effectiveFrom),
    peakPeriods: z.array(periodStringSchema).default([...DEFAULT_PRICING.peakPeriods]),
    models: z.dict(modelPricingSchema).default({ ...DEFAULT_PRICING.models }),
});
const CONFIG_KEYS = new Set(['currency', 'priceUnit', 'timezone', 'effectiveFrom', 'peakPeriods', 'models']);
/** Reject stale or misspelled keys before defaults can hide them. */
function validateConfig(config) {
    for (const key of Object.keys(config)) {
        if (!CONFIG_KEYS.has(key))
            throw new Error(`cost-meter: unknown key "${key}"`);
    }
}
/**
 * Register the `usageCost` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - the pricing schedule; defaults to the shipped DeepSeek V4 table.
 */
export function apply(ctx, config = DEFAULT_PRICING) {
    validateConfig(config);
    const schedule = resolveSchedule(config);
    ctx.sessionProjections.register(usageCostProjectionDefinition(schedule, config));
}
//# sourceMappingURL=index.js.map