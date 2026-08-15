/**
 * Parse the official DeepSeek pricing page (Docusaurus HTML) into the
 * {@link OfficialPricing} snapshot. The parser is deliberately strict: every
 * peak/off-peak bucket for both shipped models must resolve, or the whole
 * parse fails — showing a wrong price is worse than falling back to the
 * local configuration.
 * @module dsh-cost-meter/parse
 */

import type { OfficialModelPrice, OfficialPricing, OfficialTierPrices } from './prices.ts'

/** The page's shipped models, in the order the page lists them. */
const MODEL_IDS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const

/** HTML entities the pricing page uses; decoded before pattern matching. */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
}

/**
 * Strip scripts, styles, and tags, decode the page's entities, and collapse
 * whitespace into single spaces.
 * @param html - the fetched page body.
 * @returns the plain-text page.
 */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, entity => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
}

/**
 * The two numbers a flat-tier header row carries (flash first, pro second),
 * matched only when they immediately follow the marker (`数量 元 数量 元`).
 * The peak/off-peak table repeats the same headers without numbers, so the
 * immediate-match rule keeps this anchored to the flat table.
 */
const FLAT_HEADER_PATTERNS = [
  /百万tokens输入（缓存命中）\s*([\d.]+)\s*元\s*([\d.]+)\s*元/,
  /百万tokens输入（缓存未命中）\s*([\d.]+)\s*元\s*([\d.]+)\s*元/,
  /百万tokens输出\s*([\d.]+)\s*元\s*([\d.]+)\s*元/,
] as const

/**
 * The flat pre-cutover tier, when the page still carries its table.
 * @param text - the plain-text page.
 * @returns flash and pro rows, or undefined when the table is absent.
 */
function parseFlatTier(text: string): OfficialTierPrices | undefined {
  const rows = FLAT_HEADER_PATTERNS.map(pattern => pattern.exec(text))
  if (rows.some(row => row === null)) return undefined
  const hitRow = rows[0]!
  const missRow = rows[1]!
  const outputRow = rows[2]!
  const price = (index: 0 | 1): OfficialModelPrice => ({
    inputCacheHit: Number(hitRow[index + 1]),
    inputCacheMiss: Number(missRow[index + 1]),
    output: Number(outputRow[index + 1]),
  })
  return { 'deepseek-v4-flash': price(0), 'deepseek-v4-pro': price(1) }
}

/**
 * One model's peak/off-peak rows: six numbers immediately after the model
 * marker (off-peak triple, then peak triple).
 * @param text - the plain-text page.
 * @param model - the model id marker to anchor on.
 * @returns the two triples, or undefined when the row does not resolve.
 */
function parseModelTiers(text: string, model: string): { offPeak: OfficialModelPrice; peak: OfficialModelPrice } | undefined {
  const pattern = new RegExp(`${model}\\s*空闲时段\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元\\s*高峰时段\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元`)
  const match = pattern.exec(text)
  if (match === null) return undefined
  return {
    offPeak: { inputCacheHit: Number(match[1]), inputCacheMiss: Number(match[2]), output: Number(match[3]) },
    peak: { inputCacheHit: Number(match[4]), inputCacheMiss: Number(match[5]), output: Number(match[6]) },
  }
}

/**
 * The `HH:MM - HH:MM` peak intervals in the page's cutover notice.
 * @param text - the plain-text page.
 * @returns the minute ranges, in page order.
 */
function parsePeakRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  for (const match of text.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) {
    ranges.push([Number(match[1]) * 60 + Number(match[2]), Number(match[3]) * 60 + Number(match[4])])
  }
  return ranges
}

/**
 * The Chinese cutover sentence, normalized to the ISO form with the page's
 * Beijing offset.
 * @param text - the plain-text page.
 * @returns the ISO cutover, or undefined when the sentence is absent.
 */
function parseEffectiveFrom(text: string): string | undefined {
  const match = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/.exec(text)
  if (match === null) return undefined
  const pad = (value: string): string => value.padStart(2, '0')
  return `${match[1]}-${pad(match[2]!)}-${pad(match[3]!)}T${pad(match[4]!)}:${pad(match[5]!)}:00+08:00`
}

/**
 * Parse the page. Peak and off-peak buckets for every shipped model plus
 * the peak intervals are required; the flat tier and the cutover sentence
 * are best-effort (the page drops them over time).
 * @param html - the fetched page body.
 * @returns the snapshot, or null when the required parts do not resolve.
 */
export function parseOfficialPricing(html: string): OfficialPricing | null {
  const text = toText(html)
  const peak: OfficialTierPrices = {}
  const offPeak: OfficialTierPrices = {}
  for (const model of MODEL_IDS) {
    const tiers = parseModelTiers(text, model)
    if (tiers === undefined) return null
    offPeak[model] = tiers.offPeak
    peak[model] = tiers.peak
  }
  const peakRanges = parsePeakRanges(text)
  if (peakRanges.length === 0) return null
  const effectiveFrom = parseEffectiveFrom(text)
  if (effectiveFrom === undefined) return null
  const before = parseFlatTier(text)
  return {
    ...(before !== undefined ? { before } : {}),
    peak,
    offPeak,
    peakRanges,
    timezone: 'Asia/Shanghai',
    effectiveFrom,
    effectiveFromMs: Date.parse(effectiveFrom),
  }
}
