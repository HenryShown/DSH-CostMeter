/**
 * Cost surface plugin, browser half: the session-cost pill and its
 * breakdown panel. Projection-mode surface — the live value arrives through
 * `useProjection('usageCost')` (seeded by the history tail page, updated by
 * session/projection frames), so this plugin owns no store, no refresh
 * chain, and no event listener. The `usageCost` unit itself is folded by
 * this package's host half; the browser half only renders what the
 * session-projection seam already serves.
 *
 * The plugin occupies one of two composer seats, selected by config:
 * `meter` (default) registers into the named `conversation.input.meter` seat
 * right of the context-occupancy ring; `dock` is the compatibility fallback
 * for older Web surfaces and registers into the list strip above the
 * composer. Both render the same pill and panel.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type CostKey } from './locales.ts';
export { CostMeter } from './CostMeter.tsx';
export type { CostMeterViewProps } from './CostMeter.tsx';
export { currencySymbol, formatClockMs, formatCost, formatModelName, formatModelShortName, formatPrice, formatTokens, parseEffectiveFrom, parseOffsetMinutes, resolveTier, wallClockMinuteOfDay, type CostTier, } from './format.ts';
export { resolveSeat, type CostSeat } from './seat.ts';
export type { CostKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The composer cost meter's copy. */
        cost: CostKey;
    }
}
/**
 * The client plugin config: which composer seat the pill occupies. `meter`
 * is the product default; `dock` remains an explicit compatibility fallback.
 */
export interface Config {
    /** The composer seat to register into; `meter` when omitted. */
    seat?: 'dock' | 'meter';
}
/** Required services: the seat's slot registry and the locale registry. */
export declare const inject: string[];
/**
 * Client plugin body: the CostMeter entry on the configured composer seat.
 * @param ctx - client root context.
 * @param config - the seat selection.
 */
export declare function apply(ctx: ClientContext, config?: Config): void;
