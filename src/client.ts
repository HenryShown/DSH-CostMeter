/**
 * Client-namespace projection of the cost-meter domain: a pure type re-export
 * (which augments `SessionProjectionMap`). Client code imports ONLY this
 * namespace; the cross-plugin value-import gate requires it to stay
 * type-only, so display mathematics lives in the display package.
 *
 * @module dsh-cost-meter/client
 */

export type * from './types.ts'
