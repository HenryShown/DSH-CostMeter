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
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
/** The component props: the framework standard kit plus the optional bar lock. */
export interface CostMeterViewProps {
    /** The key-addressed projection reader (the framework's fifth hook seat). */
    useProjection: UseProjection;
    /** The `cost` namespace translate seat. */
    t: PropsLocale<'cost'>['t'];
    /** The composer's chrome lock; the meter seat passes it, the dock does not. */
    locked?: boolean;
}
/**
 * The session-cost meter over the host-computed `usageCost` projection.
 * Renders nothing while the capability is absent; otherwise shows a pill
 * badge whose click-open panel breaks the total down per priced model.
 */
export declare function CostMeter({ useProjection, t, locked }: CostMeterViewProps): import("react").JSX.Element | null;
