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

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the dock/meter seats).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { CostMeter } from './CostMeter.tsx'
import { en, zh, type CostKey } from './locales.ts'
import { resolveSeat } from './seat.ts'

export { CostMeter } from './CostMeter.tsx'
export type { CostMeterViewProps } from './CostMeter.tsx'
export {
  currencySymbol, formatClockMs, formatCost, formatModelName, formatModelShortName, formatPrice, formatTokens,
  parseEffectiveFrom, parseOffsetMinutes, resolveTier, wallClockMinuteOfDay, type CostTier,
} from './format.ts'
export { resolveSeat, type CostSeat } from './seat.ts'
export type { CostKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer cost meter's copy. */
    cost: CostKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'cost'

/**
 * The client plugin config: which composer seat the pill occupies. `meter`
 * is the product default; `dock` remains an explicit compatibility fallback.
 */
export interface Config {
  /** The composer seat to register into; `meter` when omitted. */
  seat?: 'dock' | 'meter'
}

/** Required services: the seat's slot registry and the locale registry. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the CostMeter entry on the configured composer seat.
 * @param ctx - client root context.
 * @param config - the seat selection.
 */
export function apply(ctx: ClientContext, config: Config = {}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-cost-meter: dictionaries')
  const seat = resolveSeat(config)

  // The two seats carry the same framework kit (useProjection, sessionId,
  // useSession, t); the meter seat adds a `locked` owner prop. The meter
  // seat key only exists in newer ui-conversation SlotMaps, so its name and
  // the component type are cast once at this boundary — an older harness
  // simply never declares the slot; those surfaces can opt into `dock` when
  // they compose this browser plugin directly.
  const register = seat === 'meter'
    ? () => ctx.slots.register({
      name: 'conversation.input.meter',
      locale: NS,
    } as never, CostMeter as never)
    : () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'cost',
      order: 20,
      locale: NS,
    } as never, CostMeter as never)

  ctx.slots.inject(seat === 'meter' ? 'conversation.input.meter' : 'conversation.input.dock', register)
}
