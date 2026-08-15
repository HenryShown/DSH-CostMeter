/**
 * Parse the official DeepSeek pricing page (Docusaurus HTML) into the
 * {@link OfficialPricing} snapshot. The parser is deliberately strict: every
 * peak/off-peak bucket for both shipped models must resolve, or the whole
 * parse fails — showing a wrong price is worse than falling back to the
 * local configuration.
 * @module dsh-cost-meter/parse
 */
import type { OfficialPricing } from './prices.ts';
/**
 * Parse the page. Peak and off-peak buckets for every shipped model plus
 * the peak intervals are required; the flat tier and the cutover sentence
 * are best-effort (the page drops them over time).
 * @param html - the fetched page body.
 * @returns the snapshot, or null when the required parts do not resolve.
 */
export declare function parseOfficialPricing(html: string): OfficialPricing | null;
