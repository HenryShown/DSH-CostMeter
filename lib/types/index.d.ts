/**
 * Function plugin registering the `usageCost` projection unit: whole-log
 * currency cost of provider usage, priced per sample at its own event time
 * under the configured DeepSeek schedule. The plugin owns only the fold and
 * the pricing table; delivery is the session-projection seam's.
 *
 * @module @deepseek-ai/dsh-cost-meter
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { CostMeterConfig } from './types.ts';
export type * from './types.ts';
export { PRICE_PER_MILLION, costOfUsage, resolveUnitPrice } from './pricing.ts';
/** Cordis plugin name. */
export declare const name = "cost-meter";
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export declare const inject: string[];
/**
 * The shipped DeepSeek V4 schedule: flat rates before 2026-08-17 00:00
 * (Asia/Shanghai), then peak rates 09:00-12:00 and 14:00-18:00 with
 * off-peak rates half the peak rates outside those intervals. Rates are CNY
 * per one million tokens; every value is overridable from cordis.yml.
 */
export declare const DEFAULT_PRICING: CostMeterConfig;
/** Runtime schema for {@link CostMeterConfig}; unknown keys are rejected by {@link validateConfig}. */
export declare const Config: z<CostMeterConfig>;
/**
 * Register the `usageCost` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - the pricing schedule; defaults to the shipped DeepSeek V4 table.
 */
export declare function apply(ctx: Context, config?: CostMeterConfig): void;
//# sourceMappingURL=index.d.ts.map