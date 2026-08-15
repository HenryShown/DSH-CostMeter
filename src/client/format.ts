/**
 * Pure display formatting for the usageCost projection value.
 * @module dsh-cost-meter/client/format
 */

/**
 * The currency's display symbol prefix. CNY and USD use their symbols; any
 * other code is spelled out before the amount.
 * @param currency - the schedule's currency code.
 * @returns the symbol prefix, e.g. `¥` or `EUR `.
 */
export function currencySymbol(currency: string): string {
  return currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `
}

/**
 * Format one currency amount for display, rounded to four decimals (the
 * cost-meter fold's display precision).
 * @param currency - the schedule's currency code.
 * @param amount - the amount to format.
 * @returns the display string, e.g. `¥1.0796` or `EUR 1.2500`.
 */
export function formatCost(currency: string, amount: number): string {
  return `${currencySymbol(currency)}${amount.toFixed(4)}`
}

/**
 * Abbreviate a token count for the panel rows: millions as one decimal
 * (`10.1M`), thousands as a whole number from 100K up (`151K`) and one
 * decimal below (`62.6K`), plain integers underneath.
 * @param tokens - the token count to format.
 * @returns the display string.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) {
    const kilo = tokens / 1_000
    return kilo >= 100 ? `${Math.round(kilo)}K` : `${kilo.toFixed(1)}K`
  }
  return String(tokens)
}

/**
 * Render one per-million price exactly as the schedule carries it (no fixed
 * decimals: `0.02`, `1`, `0.025` stay as they are).
 * @param price - the price per one million tokens.
 * @returns the plain number string.
 */
export function formatPrice(price: number): string {
  return String(price)
}

/**
 * Format an epoch-millisecond instant as the local wall-clock `HH:MM` (the
 * official-sync annotation shows no date: the panel's cutover notice already
 * carries the calendar facts).
 * @param ms - the instant to format.
 * @returns the local `HH:MM` string.
 */
export function formatClockMs(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Normalize the dash-separated model segments: `v4` promotes to `V4`, every
 * other segment is title-cased.
 * @param bare - the model id without any vendor prefix.
 * @returns the normalized segment string.
 */
function normalizeModelSegments(bare: string): string {
  return bare
    .split('-')
    .map(part => part === 'v4' ? 'V4' : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('-')
}

/**
 * Render a model id as the branded display name: the `deepseek-` vendor
 * prefix becomes the `DeepSeek-` brand prefix and the segments are
 * normalized (`deepseek-v4-pro` → `DeepSeek-V4-Pro`).
 * @param model - the model id from the schedule.
 * @returns the branded display name.
 */
export function formatModelName(model: string): string {
  const branded = model.startsWith('deepseek-')
  const bare = branded ? model.slice('deepseek-'.length) : model
  return branded ? `DeepSeek-${normalizeModelSegments(bare)}` : normalizeModelSegments(bare)
}

/**
 * Render a model id as the price table's compact name: the vendor prefix
 * drops and the segments are normalized (`deepseek-v4-flash` → `V4-Flash`).
 * @param model - the model id from the schedule.
 * @returns the table's model label.
 */
export function formatModelShortName(model: string): string {
  const bare = model.startsWith('deepseek-') ? model.slice('deepseek-'.length) : model
  return normalizeModelSegments(bare)
}

/**
 * Parse the schedule's ISO cutover into its calendar parts (the panel only
 * shows the date, never the wall time).
 * @param effectiveFrom - the configured ISO cutover string.
 * @returns the year, month (1-12), and day of the cutover.
 */
export function parseEffectiveFrom(effectiveFrom: string): { year: number; month: number; day: number } {
  return {
    year: Number(effectiveFrom.slice(0, 4)),
    month: Number(effectiveFrom.slice(5, 7)),
    day: Number(effectiveFrom.slice(8, 10)),
  }
}

/** The pricing tier in effect at one instant. */
export type CostTier = 'before' | 'peak' | 'offPeak'

/**
 * The cutover string's trailing UTC offset in minutes (its `±HH:MM`
 * suffix); 0 when the string carries none.
 * @param effectiveFrom - the configured ISO cutover string.
 * @returns the offset in minutes.
 */
export function parseOffsetMinutes(effectiveFrom: string): number {
  const match = /([+-])(\d{2}):(\d{2})$/.exec(effectiveFrom)
  if (match === null) return 0
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3]))
}

/**
 * The wall-clock minute of day (0-1439) in the schedule's timezone for one
 * instant. The IANA zone resolves through `Intl`; an invalid zone name falls
 * back to the cutover string's own offset.
 * @param timezone - the configured IANA timezone.
 * @param fallbackOffsetMinutes - offset used when the zone cannot resolve.
 * @param nowMs - the instant to read.
 * @returns the wall-clock minute of day.
 */
export function wallClockMinuteOfDay(timezone: string, fallbackOffsetMinutes: number, nowMs: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(nowMs))
    const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0')
    const minute = Number(parts.find(part => part.type === 'minute')?.value ?? '0')
    return (hour === 24 ? 0 : hour) * 60 + minute
  } catch {
    const wall = new Date(nowMs + fallbackOffsetMinutes * 60_000)
    return wall.getUTCHours() * 60 + wall.getUTCMinutes()
  }
}

/**
 * Resolve the pricing tier in effect at one instant under the configured
 * schedule: flat `before` until the cutover, then `peak` inside any peak
 * interval (end-exclusive local wall time) and `offPeak` everywhere else.
 * @param schedule - the schedule snapshot (cutover plus peak ranges).
 * @param nowMs - the instant to resolve.
 * @returns the tier that prices that instant.
 */
export function resolveTier(
  schedule: {
    effectiveFrom: string
    effectiveFromMs: number
    timezone: string
    peakRanges: readonly (readonly [number, number])[]
  },
  nowMs: number,
): CostTier {
  if (nowMs < schedule.effectiveFromMs) return 'before'
  const minute = wallClockMinuteOfDay(schedule.timezone, parseOffsetMinutes(schedule.effectiveFrom), nowMs)
  for (const [start, end] of schedule.peakRanges) {
    if (minute >= start && minute < end) return 'peak'
  }
  return 'offPeak'
}
