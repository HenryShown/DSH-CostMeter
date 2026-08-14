/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cost-meter`.
 * @module @deepseek-ai/dsh-cost-meter/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-cost-meter';
/** Cordis companion plugin name. */
export const name = 'cost-meter-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the package owns a pure pricing fold whose Config is
 * schema-validated at load, whose wire payload is schema-validated by the
 * projection registry at every snapshot and change-feed emission, and whose
 * usage-sample replacement relation (one final sample per turn/step) is
 * owned by the agent loop's session-log contract, not here.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map