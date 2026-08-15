/**
 * The client plugin's seat selection: which composer slot the cost pill
 * registers into. Kept as a pure function so both the plugin body and its
 * tests share one resolution path.
 * @module dsh-cost-meter/client/seat
 */

import type { Config } from './index.ts'

/** The composer seats the pill can occupy. */
export type CostSeat = 'dock' | 'meter'

/**
 * Resolve the configured seat, rejecting unknown values loud.
 * @param config - the validated plugin config.
 * @returns the seat name.
 */
export function resolveSeat(config: Config): CostSeat {
  const seat = config.seat ?? 'meter'
  if (seat !== 'dock' && seat !== 'meter') {
    throw new Error(`dsh-cost-meter: unknown seat ${JSON.stringify(seat)} — expected "dock" or "meter"`)
  }
  return seat
}
