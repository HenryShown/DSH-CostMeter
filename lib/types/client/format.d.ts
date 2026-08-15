/**
 * Pure display formatting for the usageCost projection value.
 * @module dsh-cost-meter/client/format
 */
/**
 * The currency's display symbol prefix. CNY and USD use their symbols; any
 * other code is spelled out before the amount.
 * @param currency - the schedule's currency code.
 * @returns the symbol prefix, e.g. `¥` or `EUR `.
 */
export declare function currencySymbol(currency: string): string;
/**
 * Format one currency amount for display, rounded to four decimals (the
 * cost-meter fold's display precision).
 * @param currency - the schedule's currency code.
 * @param amount - the amount to format.
 * @returns the display string, e.g. `¥1.0796` or `EUR 1.2500`.
 */
export declare function formatCost(currency: string, amount: number): string;
/**
 * Abbreviate a token count for the panel rows: millions as one decimal
 * (`10.1M`), thousands as a whole number from 100K up (`151K`) and one
 * decimal below (`62.6K`), plain integers underneath.
 * @param tokens - the token count to format.
 * @returns the display string.
 */
export declare function formatTokens(tokens: number): string;
/**
 * Render one per-million price exactly as the schedule carries it (no fixed
 * decimals: `0.02`, `1`, `0.025` stay as they are).
 * @param price - the price per one million tokens.
 * @returns the plain number string.
 */
export declare function formatPrice(price: number): string;
/**
 * Format an epoch-millisecond instant as the local wall-clock `HH:MM` (the
 * official-sync annotation shows no date: the panel's cutover notice already
 * carries the calendar facts).
 * @param ms - the instant to format.
 * @returns the local `HH:MM` string.
 */
export declare function formatClockMs(ms: number): string;
/**
 * Render a model id as the branded display name: the `deepseek-` vendor
 * prefix becomes the `DeepSeek-` brand prefix and the segments are
 * normalized (`deepseek-v4-pro` → `DeepSeek-V4-Pro`).
 * @param model - the model id from the schedule.
 * @returns the branded display name.
 */
export declare function formatModelName(model: string): string;
/**
 * Render a model id as the price table's compact name: the vendor prefix
 * drops and the segments are normalized (`deepseek-v4-flash` → `V4-Flash`).
 * @param model - the model id from the schedule.
 * @returns the table's model label.
 */
export declare function formatModelShortName(model: string): string;
/**
 * Parse the schedule's ISO cutover into its calendar parts (the panel only
 * shows the date, never the wall time).
 * @param effectiveFrom - the configured ISO cutover string.
 * @returns the year, month (1-12), and day of the cutover.
 */
export declare function parseEffectiveFrom(effectiveFrom: string): {
    year: number;
    month: number;
    day: number;
};
/** The pricing tier in effect at one instant. */
export type CostTier = 'before' | 'peak' | 'offPeak';
/**
 * The cutover string's trailing UTC offset in minutes (its `±HH:MM`
 * suffix); 0 when the string carries none.
 * @param effectiveFrom - the configured ISO cutover string.
 * @returns the offset in minutes.
 */
export declare function parseOffsetMinutes(effectiveFrom: string): number;
/**
 * The wall-clock minute of day (0-1439) in the schedule's timezone for one
 * instant. The IANA zone resolves through `Intl`; an invalid zone name falls
 * back to the cutover string's own offset.
 * @param timezone - the configured IANA timezone.
 * @param fallbackOffsetMinutes - offset used when the zone cannot resolve.
 * @param nowMs - the instant to read.
 * @returns the wall-clock minute of day.
 */
export declare function wallClockMinuteOfDay(timezone: string, fallbackOffsetMinutes: number, nowMs: number): number;
/**
 * Resolve the pricing tier in effect at one instant under the configured
 * schedule: flat `before` until the cutover, then `peak` inside any peak
 * interval (end-exclusive local wall time) and `offPeak` everywhere else.
 * @param schedule - the schedule snapshot (cutover plus peak ranges).
 * @param nowMs - the instant to resolve.
 * @returns the tier that prices that instant.
 */
export declare function resolveTier(schedule: {
    effectiveFrom: string;
    effectiveFromMs: number;
    timezone: string;
    peakRanges: readonly (readonly [number, number])[];
}, nowMs: number): CostTier;
