/**
 * Function plugin registering the `usageCost` projection unit: whole-log
 * currency cost of provider usage, priced per sample at its own event time
 * under the configured DeepSeek schedule. The plugin owns only the fold and
 * the pricing table; delivery is the session-projection seam's.
 *
 * On surfaces that mount a web server (the Web profile), the same plugin
 * additionally runs the official-price feed: it refreshes the official
 * DeepSeek pricing page on an interval and serves the parsed snapshot on
 * {@link PRICES_ENDPOINT} for the browser half to prefer over the local
 * configuration. Surfaces without a web server keep the projection only.
 *
 * @module dsh-cost-meter
 */

import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the webServer Context merge for the optional feed route.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveSchedule } from './pricing.ts'
import { usageCostProjectionDefinition } from './projection.ts'
import { parseOfficialPricing } from './parse.ts'
import { PRICES_ENDPOINT, type OfficialPricing, type OfficialPricingResponse } from './prices.ts'
import type { CostMeterConfig, ModelPricingConfig, UnitPrice } from './types.ts'

export type * from './types.ts'
export { PRICE_PER_MILLION, costOfUsage, resolveUnitPrice } from './pricing.ts'
export { parseOfficialPricing } from './parse.ts'
export { PRICES_ENDPOINT, type OfficialPricing, type OfficialPricingResponse } from './prices.ts'

/** Cordis plugin name. */
export const name = 'cost-meter'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/** The official pricing page, in the same locale the parser targets. */
const DEFAULT_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'

const unitPriceSchema: z<UnitPrice> = z.object({
  inputCacheHit: z.number().min(0),
  inputCacheMiss: z.number().min(0),
  output: z.number().min(0),
})

const modelPricingSchema: z<ModelPricingConfig> = z.object({
  before: unitPriceSchema,
  peak: unitPriceSchema,
  offPeak: unitPriceSchema,
})

const periodStringSchema = z.string().pattern(/^\d{2}:\d{2}-\d{2}:\d{2}$/)

/**
 * The shipped DeepSeek V4 schedule: flat rates before 2026-08-17 00:00
 * (Asia/Shanghai), then peak rates 09:00-12:00 and 14:00-18:00 with
 * off-peak rates half the peak rates outside those intervals. Rates are CNY
 * per one million tokens; every value is overridable from cordis.yml.
 */
export const DEFAULT_PRICING: CostMeterConfig = {
  currency: 'CNY',
  priceUnit: 'per_1M_tokens',
  timezone: 'Asia/Shanghai',
  effectiveFrom: '2026-08-17T00:00:00+08:00',
  peakPeriods: ['09:00-12:00', '14:00-18:00'],
  models: {
    'deepseek-v4-flash': {
      before: { inputCacheHit: 0.02, inputCacheMiss: 1.00, output: 2.00 },
      peak: { inputCacheHit: 0.10, inputCacheMiss: 3.00, output: 9.00 },
      offPeak: { inputCacheHit: 0.05, inputCacheMiss: 1.50, output: 4.50 },
    },
    'deepseek-v4-pro': {
      before: { inputCacheHit: 0.025, inputCacheMiss: 3.00, output: 6.00 },
      peak: { inputCacheHit: 0.30, inputCacheMiss: 9.00, output: 27.00 },
      offPeak: { inputCacheHit: 0.15, inputCacheMiss: 4.50, output: 13.50 },
    },
  },
}

/** Runtime schema for {@link CostMeterConfig}; unknown keys are rejected by {@link validateConfig}. */
export const Config: z<CostMeterConfig> = z.object({
  currency: z.string().min(1).default(DEFAULT_PRICING.currency),
  priceUnit: z.const('per_1M_tokens').default(DEFAULT_PRICING.priceUnit),
  timezone: z.string().min(1).default(DEFAULT_PRICING.timezone),
  effectiveFrom: z.string().min(1).default(DEFAULT_PRICING.effectiveFrom),
  peakPeriods: z.array(periodStringSchema).default([...DEFAULT_PRICING.peakPeriods]),
  models: z.dict(modelPricingSchema).default({ ...DEFAULT_PRICING.models }),
  pricingUrl: z.string().min(1).default(DEFAULT_PRICING_URL),
  refreshIntervalMs: z.number().step(1).min(1).default(3_600_000),
  requestTimeoutMs: z.number().step(1).min(1).default(10_000),
}) as unknown as z<CostMeterConfig>

const CONFIG_KEYS = new Set([
  'currency', 'priceUnit', 'timezone', 'effectiveFrom', 'peakPeriods', 'models',
  'pricingUrl', 'refreshIntervalMs', 'requestTimeoutMs',
])

/** Reject stale or misspelled keys before defaults can hide them. */
function validateConfig(config: CostMeterConfig): void {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`cost-meter: unknown key "${key}"`)
  }
}

/** The web-server face the optional feed needs (absence skips the feed). */
interface WebServerLike {
  register(route: {
    kind: string
    path: string
    handler: (req: { method?: string }, res: ServerResponse) => void
  }): () => void
}

/**
 * Mount the official-price feed: one refresh at activation plus an unref'd
 * interval, and the JSON route the browser half reads.
 * @param ctx - host context carrying the web route registry.
 * @param webServer - the surface's web route registry.
 * @param pricingUrl - the official pricing page URL.
 * @param refreshIntervalMs - refresh interval in milliseconds.
 * @param requestTimeoutMs - per-request timeout in milliseconds.
 */
function mountPricingFeed(
  ctx: Context,
  webServer: WebServerLike,
  pricingUrl: string,
  refreshIntervalMs: number,
  requestTimeoutMs: number,
): void {
  let snapshot: OfficialPricing | null = null
  let fetchedAt = 0
  let stopped = false
  let inFlight: Promise<void> | undefined
  let activeController: AbortController | undefined

  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (inFlight !== undefined) return inFlight

    const controller = new AbortController()
    activeController = controller
    const timeout = setTimeout(() => { controller.abort() }, requestTimeoutMs)
    timeout.unref()
    const operation = (async () => {
      try {
        const response = await fetch(pricingUrl, { signal: controller.signal })
        if (!response.ok) return
        const parsed = parseOfficialPricing(await response.text())
        if (parsed !== null && !stopped) {
          snapshot = parsed
          fetchedAt = Date.now()
        }
      } catch {
        // Network failure, timeout, teardown, or page-shape drift: keep the last good snapshot.
      }
    })()
    inFlight = operation.finally(() => {
      clearTimeout(timeout)
      if (activeController === controller) activeController = undefined
      inFlight = undefined
    })
    return inFlight
  }

  ctx.effect(() => {
    // Starting the request inside the loader's activation stack makes its
    // timeout elapse while the Web surface is still doing synchronous boot
    // work. Defer once so the request budget starts after that stack yields.
    const initial = setTimeout(() => { void refresh() }, 0)
    initial.unref()
    const timer = setInterval(() => { void refresh() }, refreshIntervalMs)
    timer.unref()
    return () => {
      stopped = true
      clearTimeout(initial)
      clearInterval(timer)
      activeController?.abort()
    }
  }, 'cost-meter: official pricing refresh')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PRICES_ENDPOINT,
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const body: OfficialPricingResponse = snapshot === null
        ? { ok: false }
        : { ok: true, fetchedAt, prices: snapshot }
      res.writeHead(snapshot === null ? 404 : 200, {
        'content-type': 'application/json',
        'cache-control': 'no-cache',
      })
      res.end(JSON.stringify(body))
    },
  }), 'cost-meter: official pricing route')
}

/**
 * Register the `usageCost` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key. Surfaces with a web server
 * additionally mount the official-price feed.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - the pricing schedule; defaults to the shipped DeepSeek V4 table.
 */
export function apply(ctx: Context, config: CostMeterConfig = DEFAULT_PRICING): void {
  validateConfig(config)
  const schedule = resolveSchedule(config)
  ctx.sessionProjections.register(usageCostProjectionDefinition(schedule, config))

  // The feed is optional: surfaces without a web server (headless, TUI)
  // keep the projection and skip the route. The web server row may activate
  // after this plugin (no shared dependency), so the mount runs once at
  // activation and again when the `webServer` service registers.
  let feedMounted = false
  const mountFeed = (): void => {
    if (feedMounted) return
    const webServer = ctx.get('webServer', false) as WebServerLike | undefined
    if (webServer === undefined) return
    feedMounted = true
    mountPricingFeed(
      ctx,
      webServer,
      config.pricingUrl ?? DEFAULT_PRICING_URL,
      config.refreshIntervalMs ?? 3_600_000,
      config.requestTimeoutMs ?? 10_000,
    )
  }
  mountFeed()
  ctx.on('internal/service', (name: string) => {
    if (name === 'webServer') mountFeed()
  })
}
