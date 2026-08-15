//#region src/invariant.ts
const PACKAGE_NAME = "dsh-cost-meter";
/** Cordis companion plugin name. */
const name = "cost-meter-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the package owns a pure pricing fold whose Config is
* schema-validated at load, whose wire payload is schema-validated by the
* projection registry at every snapshot and change-feed emission, and whose
* usage-sample replacement relation (one final sample per turn/step) is
* owned by the agent loop's session-log contract, not here.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
