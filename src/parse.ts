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

/** A non-negative decimal accepted from the official table. */
const PRICE_SOURCE = String.raw`\d+(?:\.\d+)?`

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
  /百万tokens输入（缓存命中）\s*(\d+(?:\.\d+)?)\s*元\s*(\d+(?:\.\d+)?)\s*元/,
  /百万tokens输入（缓存未命中）\s*(\d+(?:\.\d+)?)\s*元\s*(\d+(?:\.\d+)?)\s*元/,
  /百万tokens输出\s*(\d+(?:\.\d+)?)\s*元\s*(\d+(?:\.\d+)?)\s*元/,
] as const

/** Parse one finite, non-negative price. */
function parsePrice(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Parse three price buckets, rejecting the whole row when one is invalid. */
function parsePriceRow(
  inputCacheHit: string | undefined,
  inputCacheMiss: string | undefined,
  output: string | undefined,
): OfficialModelPrice | undefined {
  const row = {
    inputCacheHit: parsePrice(inputCacheHit),
    inputCacheMiss: parsePrice(inputCacheMiss),
    output: parsePrice(output),
  }
  return row.inputCacheHit === undefined || row.inputCacheMiss === undefined || row.output === undefined
    ? undefined
    : row as OfficialModelPrice
}

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
  const flash = parsePriceRow(hitRow[1], missRow[1], outputRow[1])
  const pro = parsePriceRow(hitRow[2], missRow[2], outputRow[2])
  return flash === undefined || pro === undefined
    ? undefined
    : { 'deepseek-v4-flash': flash, 'deepseek-v4-pro': pro }
}

/**
 * One model's peak/off-peak rows: six numbers immediately after the model
 * marker (off-peak triple, then peak triple).
 * @param text - the plain-text page.
 * @param model - the model id marker to anchor on.
 * @returns the two triples, or undefined when the row does not resolve.
 */
function parseModelTiers(text: string, model: string): { offPeak: OfficialModelPrice; peak: OfficialModelPrice } | undefined {
  const pattern = new RegExp(`${model}\\s*空闲时段\\s*(${PRICE_SOURCE})\\s*元\\s*(${PRICE_SOURCE})\\s*元\\s*(${PRICE_SOURCE})\\s*元\\s*高峰时段\\s*(${PRICE_SOURCE})\\s*元\\s*(${PRICE_SOURCE})\\s*元\\s*(${PRICE_SOURCE})\\s*元`)
  const match = pattern.exec(text)
  if (match === null) return undefined
  const offPeak = parsePriceRow(match[1], match[2], match[3])
  const peak = parsePriceRow(match[4], match[5], match[6])
  return offPeak === undefined || peak === undefined ? undefined : { offPeak, peak }
}

/**
 * The `HH:MM - HH:MM` peak intervals in the page's cutover notice.
 * @param text - the plain-text page.
 * @returns the minute ranges, in page order.
 */
function parsePeakRanges(text: string): [number, number][] | undefined {
  const notice = /高峰时段为北京时间\s*([^。]*)/.exec(text)?.[1]
  if (notice === undefined) return []
  const ranges: [number, number][] = []
  for (const match of notice.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) {
    const startHour = Number(match[1])
    const startMinute = Number(match[2])
    const endHour = Number(match[3])
    const endMinute = Number(match[4])
    if (
      startHour > 23 || startMinute > 59
      || endHour > 24 || endMinute > 59
      || (endHour === 24 && endMinute !== 0)
    ) return undefined
    const start = startHour * 60 + startMinute
    const end = endHour * 60 + endMinute
    if (start >= end) return undefined
    ranges.push([start, end])
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
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (
    month < 1 || month > 12
    || day < 1 || day > days[month - 1]!
    || hour > 23 || minute > 59
  ) return undefined
  const pad = (value: string): string => value.padStart(2, '0')
  return `${match[1]}-${pad(match[2]!)}-${pad(match[3]!)}T${pad(match[4]!)}:${pad(match[5]!)}:00+08:00`
}

/**
 * Parse the page. Peak and off-peak buckets for every shipped model, the
 * peak intervals, and the cutover sentence are required. Only the flat tier
 * is optional because the page can drop it after the cutover.
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
  if (peakRanges === undefined || peakRanges.length === 0) return null
  const effectiveFrom = parseEffectiveFrom(text)
  if (effectiveFrom === undefined) return null
  const effectiveFromMs = Date.parse(effectiveFrom)
  if (!Number.isFinite(effectiveFromMs)) return null
  const before = parseFlatTier(text)
  return {
    ...(before !== undefined ? { before } : {}),
    peak,
    offPeak,
    peakRanges,
    timezone: 'Asia/Shanghai',
    effectiveFrom,
    effectiveFromMs,
  }
}
