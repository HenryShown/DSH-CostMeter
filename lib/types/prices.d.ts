/**
 * The official pricing snapshot contract shared by the node half (producer)
 * and the browser half (consumer). The node half refreshes this from the
 * official DeepSeek pricing page and serves it on {@link PRICES_ENDPOINT};
 * the browser panel prefers it over the locally configured schedule and
 * falls back when the route reports no snapshot.
 */
/** One model's three bucket prices, currency per one million tokens. */
export interface OfficialModelPrice {
    inputCacheHit: number;
    inputCacheMiss: number;
    output: number;
}
/** One tier's prices across models, keyed by the schedule's model id. */
export type OfficialTierPrices = Record<string, OfficialModelPrice>;
/** The parsed official snapshot: the tiers plus the cutover facts. */
export interface OfficialPricing {
    /** The pre-cutover flat tier; absent once the official page drops it. */
    before?: OfficialTierPrices;
    peak?: OfficialTierPrices;
    offPeak?: OfficialTierPrices;
    /** `[startMinutes, endMinutes)` peak intervals in the snapshot's timezone. */
    peakRanges: readonly (readonly [number, number])[];
    timezone: string;
    effectiveFrom: string;
    effectiveFromMs: number;
}
/** The local route payload: a successful snapshot or an explicit miss. */
export type OfficialPricingResponse = {
    ok: true;
    fetchedAt: number;
    prices: OfficialPricing;
} | {
    ok: false;
};
/** Local route the node half serves and the browser half reads. */
export declare const PRICES_ENDPOINT = "/plugins/dsh-cost-meter/prices.json";
