/**
 * The `usageCost` projection unit: the registry drive serves whole-log cost
 * figures, the fold prices each sample at its own event time under the model
 * recorded by the newest `request/header`, chunk usage is replaced by the
 * assembled message's usage for the same turn/step, and unloading the plugin
 * removes the key (HMR safety). Exact currency figures run against the
 * exported definition where event times are controlled; registry-driven
 * cases assert time-independent structure only.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, type TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as CostMeter from '../src/index.ts'
import { DEFAULT_PRICING } from '../src/index.ts'
import { usageCostProjectionDefinition } from '../src/projection.ts'
import { resolveSchedule } from '../src/pricing.ts'

const SAMPLE_USAGE: TokenUsage = {
  inputTokens: 2,
  cacheReadTokens: 5,
  cacheWriteTokens: 5,
  outputTokens: 3,
}

async function harness(withPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withPlugin) await ctx.plugin(CostMeter)
  return { ctx, session: ctx.sessions.create(SessionId('costed')) }
}

/** Append an assembled assistant message carrying usage for one turn/step. */
function appendUsage(session: Session, turn: number, step: number, usage: TokenUsage): void {
  session.append('assistant/message', {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'reply' }],
      source: { kind: 'model', provider: 'mock', model: 'deepseek-v4-flash' },
    }),
    usage,
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

/** Build one synthetic committed event with a controlled timestamp. */
function at(time: number, type: string, data: unknown): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

/** Fold a synthetic event list through the shipped-schedule definition and view the result. */
function fold(events: readonly SessionEvent[]) {
  const definition = usageCostProjectionDefinition(
    resolveSchedule(DEFAULT_PRICING),
    DEFAULT_PRICING,
  )
  const state = events.reduce(
    (folded, event) => definition.apply(folded, event),
    definition.init(),
  )
  return definition.view(state)
}

const header = (model: string) => at(
  Date.parse('2026-08-18T02:59:00+08:00'),
  'request/header',
  { header: { config: { provider: 'mock', model } }, reason: 'initial' },
)

const usageEvent = (time: number, turn: number, step: number, usage: TokenUsage) => at(
  time,
  'assistant/message',
  { turn, step, message: { content: [] }, usage },
)

describe('usageCost projection unit (registry drive)', () => {
  it('serves the zero figure and the schedule snapshot on the empty log', async () => {
    const { ctx, session } = await harness(true)
    const value = ctx.sessionProjections.snapshot(session).values.usageCost
    expect(value).toMatchObject({ currency: 'CNY', totalCost: 0, models: [] })
    expect(value?.schedule.effectiveFrom).toBe(DEFAULT_PRICING.effectiveFrom)
  })

  it('folds one priced sample into per-model buckets, cost, and total', async () => {
    const { ctx, session } = await harness(true)
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'deepseek-v4-flash' } },
      reason: 'initial',
    })
    appendUsage(session, 1, 1, SAMPLE_USAGE)
    const value = ctx.sessionProjections.snapshot(session).values.usageCost
    const model = value?.models[0]
    expect(model).toMatchObject({
      model: 'deepseek-v4-flash',
      inputCacheHitTokens: 5,
      inputCacheMissTokens: 7,
      outputTokens: 3,
    })
    expect(typeof model?.cost).toBe('number')
    expect(model?.cost).toBeGreaterThan(0)
    expect(value?.totalCost).toBe(model?.cost)
  })

  it('keeps separate rows per model across a mid-session model switch', async () => {
    const { ctx, session } = await harness(true)
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'deepseek-v4-flash' } },
      reason: 'initial',
    })
    appendUsage(session, 1, 1, SAMPLE_USAGE)
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'deepseek-v4-pro' } },
      reason: 'change',
    })
    appendUsage(session, 2, 1, SAMPLE_USAGE)
    const value = ctx.sessionProjections.snapshot(session).values.usageCost
    expect(value?.models.map(model => model.model))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })

  it('prices nothing for a model with no schedule entry', async () => {
    const { ctx, session } = await harness(true)
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'unpriced-model' } },
      reason: 'initial',
    })
    appendUsage(session, 1, 1, SAMPLE_USAGE)
    const value = ctx.sessionProjections.snapshot(session).values.usageCost
    expect(value).toMatchObject({ totalCost: 0, models: [] })
  })

  it('has no usageCost key without the plugin, folds existing events on late mount, and drops it on unload', async () => {
    const { ctx, session } = await harness(false)
    expect('usageCost' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'deepseek-v4-flash' } },
      reason: 'initial',
    })
    appendUsage(session, 1, 1, SAMPLE_USAGE)
    const fiber = await ctx.plugin(CostMeter)
    const value = ctx.sessionProjections.snapshot(session).values.usageCost
    expect(value?.models[0]).toMatchObject({
      model: 'deepseek-v4-flash',
      inputCacheHitTokens: 5,
      inputCacheMissTokens: 7,
      outputTokens: 3,
    })
    await fiber.dispose()
    expect('usageCost' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

describe('usageCost fold (controlled timestamps)', () => {
  it('prices the flash off-peak tier exactly', () => {
    expect(fold([
      header('deepseek-v4-flash'),
      usageEvent(Date.parse('2026-08-18T03:00:00+08:00'), 1, 1, {
        inputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 2_000_000,
        outputTokens: 1_000_000,
      }),
    ])).toMatchObject({ totalCost: 0.05 + 3.00 + 4.50, models: [{ model: 'deepseek-v4-flash' }] })
  })

  it('prices the flat pre-cutover tier before 2026-08-17', () => {
    expect(fold([
      header('deepseek-v4-flash'),
      usageEvent(Date.parse('2026-08-16T10:00:00+08:00'), 1, 1, {
        inputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ])).toMatchObject({ totalCost: 0.02 + 1.00 + 2.00 })
  })

  it('prices the pro peak tier exactly', () => {
    expect(fold([
      header('deepseek-v4-pro'),
      usageEvent(Date.parse('2026-08-18T10:00:00+08:00'), 1, 1, {
        inputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ])).toMatchObject({ totalCost: 0.30 + 9.00 + 27.00 })
  })

  it('prices nothing before any request header', () => {
    expect(fold([
      usageEvent(Date.parse('2026-08-18T03:00:00+08:00'), 1, 1, SAMPLE_USAGE),
    ])).toMatchObject({ totalCost: 0, models: [] })
  })

  it('replaces the chunk sample with the assembled message sample for the same turn/step', () => {
    expect(fold([
      header('deepseek-v4-flash'),
      at(Date.parse('2026-08-18T03:00:00+08:00'), 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'usage', usage: SAMPLE_USAGE },
      }),
      usageEvent(Date.parse('2026-08-18T03:00:01+08:00'), 1, 1, {
        inputTokens: 0,
        cacheReadTokens: 100,
        cacheWriteTokens: 200,
        outputTokens: 300,
      }),
    ])).toMatchObject({
      // (100 x 0.05 + 200 x 1.50 + 300 x 4.50) / 1M, in the fold's summation order.
      totalCost: 1655 / 1_000_000,
      models: [{
        model: 'deepseek-v4-flash',
        inputCacheHitTokens: 100,
        inputCacheMissTokens: 200,
        outputTokens: 300,
      }],
    })
  })

  it('credits the replaced sample back to its own model row when the model switches mid-step', () => {
    expect(fold([
      header('deepseek-v4-flash'),
      at(Date.parse('2026-08-18T03:00:00+08:00'), 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'usage',
          usage: { inputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, outputTokens: 1_000_000 },
        },
      }),
      header('deepseek-v4-pro'),
      usageEvent(Date.parse('2026-08-18T03:00:01+08:00'), 1, 1, {
        inputTokens: 0,
        cacheReadTokens: 100,
        cacheWriteTokens: 200,
        outputTokens: 300,
      }),
    ])).toMatchObject({
      // The chunk left the flash row entirely; the message prices under pro off-peak.
      totalCost: 4965 / 1_000_000,
      models: [
        {
          model: 'deepseek-v4-flash',
          cost: 0,
          inputCacheHitTokens: 0,
          inputCacheMissTokens: 0,
          outputTokens: 0,
        },
        {
          model: 'deepseek-v4-pro',
          cost: 4965 / 1_000_000,
          inputCacheHitTokens: 100,
          inputCacheMissTokens: 200,
          outputTokens: 300,
        },
      ],
    })
  })
})
