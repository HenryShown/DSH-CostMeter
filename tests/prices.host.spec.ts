/**
 * The host half's official-price feed: one fetch at activation plus an
 * interval, a JSON route over the web registry, and explicit misses when no
 * snapshot exists. A failed fetch or parse keeps the previous snapshot;
 * teardown removes the route and stops the interval. Surfaces without a web
 * server keep the projection and skip the feed.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRICES_ENDPOINT } from '../src/prices.ts'
import { apply, Config, inject } from '../src/index.ts'

const fixture = (): string =>
  readFileSync(fileURLToPath(new URL('./fixtures/pricing-page.html', import.meta.url)), 'utf8')

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

interface Route {
  kind: string
  path: string
  handler: (req: { method?: string }, res: { writeHead: (status: number, headers?: object) => void; end: (body?: string) => void }) => void
}

async function bench(fetchImpl: () => Promise<Response>, hasWebServer = true) {
  vi.stubGlobal('fetch', fetchImpl)
  const ctx = new Context()
  const projections = { register: vi.fn() }
  ctx.provide('sessionProjections', projections)
  let route: Route | undefined
  const disposeRoute = vi.fn()
  if (hasWebServer) {
    ctx.provide('webServer', {
      register: vi.fn((candidate: Route) => {
        route = candidate
        return disposeRoute
      }),
    })
  }
  const fiber = ctx.plugin({ name: 'cost-meter', inject: [...inject], Config, apply }, {
    refreshIntervalMs: 60_000,
    requestTimeoutMs: 5_000,
  } as never)
  await fiber.await()
  const call = (method = 'GET'): { body: string; status: number } => {
    let body = ''
    let status = 0
    route!.handler({ method }, {
      writeHead: (code) => { status = code },
      end: (payload) => { body = payload ?? '' },
    })
    return { body, status }
  }
  return { ctx, fiber, projections, disposeRoute, route: () => route!, call, hasRoute: () => route !== undefined }
}

describe('dsh-cost-meter official pricing feed', () => {
  it('declares every service it binds and registers the projection', async () => {
    expect(inject).toEqual(['sessionProjections'])
    expect(Config).toBeDefined()
    const b = await bench(async () => { throw new Error('offline') })
    expect(b.projections.register).toHaveBeenCalledTimes(1)
  })

  it('fetches once at activation and serves the parsed snapshot', async () => {
    const fetchImpl = vi.fn(async () => new Response(fixture(), { status: 200 }))
    const b = await bench(fetchImpl)
    await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => {
      const { status, body } = b.call()
      expect(status).toBe(200)
      const payload = JSON.parse(body) as { ok: boolean; fetchedAt: number; prices?: { peak: object } }
      expect(payload.ok).toBe(true)
      expect(payload.prices!.peak).toEqual({
        'deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 },
        'deepseek-v4-pro': { inputCacheHit: 0.3, inputCacheMiss: 9, output: 27 },
      })
      expect(payload.fetchedAt).toBeGreaterThan(0)
    })
    expect(b.route().path).toBe(PRICES_ENDPOINT)
  })

  it('serves an explicit miss before any successful fetch', async () => {
    const b = await bench(async () => { throw new Error('offline') })
    await vi.waitFor(() => {
      const { status, body } = b.call()
      expect(status).toBe(404)
      expect(JSON.parse(body)).toEqual({ ok: false })
    })
  })

  it('keeps the last good snapshot when a later refresh fails', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => new Response(fixture(), { status: 200 }))
    const b = await bench(fetchImpl)
    await vi.advanceTimersByTimeAsync(0)
    expect(JSON.parse(b.call().body).ok).toBe(true)
    fetchImpl.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(0)
    const { status, body } = b.call()
    expect(status).toBe(200)
    expect(JSON.parse(body).ok).toBe(true)
  })

  it('rejects non-GET requests and disposes the route on teardown', async () => {
    const b = await bench(async () => new Response(fixture(), { status: 200 }))
    await vi.waitFor(() => { expect(b.hasRoute()).toBe(true) })
    expect(b.call('POST').status).toBe(405)
    await b.fiber.dispose()
    expect(b.disposeRoute).toHaveBeenCalled()
  })

  it('skips the feed on surfaces without a web server', async () => {
    const fetchImpl = vi.fn(async () => new Response(fixture(), { status: 200 }))
    const b = await bench(fetchImpl, false)
    await vi.waitFor(() => { expect(b.projections.register).toHaveBeenCalledTimes(1) })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(b.hasRoute()).toBe(false)
  })

  it('mounts the feed when the web server registers after activation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fixture(), { status: 200 })))
    const ctx = new Context()
    ctx.provide('sessionProjections', { register: vi.fn() })
    let route: Route | undefined
    const disposeRoute = vi.fn()
    const fiber = ctx.plugin({ name: 'cost-meter', inject: [...inject], Config, apply }, {
      refreshIntervalMs: 60_000,
      requestTimeoutMs: 5_000,
    } as never)
    await fiber.await()
    ctx.provide('webServer', {
      register: vi.fn((candidate: Route) => {
        route = candidate
        return disposeRoute
      }),
    })
    await vi.waitFor(() => { expect(route).toBeDefined() })
    expect(route!.path).toBe(PRICES_ENDPOINT)
  })
})
