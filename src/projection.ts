/**
 * The `usageCost` projection unit: a pure fold of logged provider usage into
 * currency cost under the configured pricing schedule. The fold mirrors
 * dsh-token-meter's usage-sample replacement invariant, one final sample
 * per `(turn, step)`, so chunk usage and the assembled message's usage are
 * never double-counted. Each sample is priced at its own event time under
 * the model recorded by the newest `request/header`, so a model switch or a
 * schedule cutover reprices only later samples. A replacement credits the
 * superseded sample back to its own model's row before the new sample
 * lands, so a mid-step model switch moves the step's usage to the new
 * model instead of double counting it.
 *
 * @module dsh-cost-meter/projection
 */

import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { costOfUsage, resolveUnitPrice, type ResolvedPricingSchedule } from './pricing.ts'
import type { PricingScheduleConfig, UsageCostModel } from './types.ts'

/** The disjoint buckets one sample contributes, before currency pricing. */
interface UsageBuckets {
  inputCacheHitTokens: number
  inputCacheMissTokens: number
  outputTokens: number
}

/** One priced sample; the `last` slot implements the per-`(turn, step)` replacement invariant. */
interface UsageSample {
  turn: number
  step: number
  model: string
  buckets: UsageBuckets
  cost: number
}

/** Plain-JSON fold state per the projection unit contract. */
interface CostState {
  /** Insertion-ordered rows for models that logged at least one priced sample. */
  models: UsageCostModel[]
  last: UsageSample | null
  currentModel: string | null
}

const bucketsFrom = (usage: TokenUsage): UsageBuckets => ({
  inputCacheHitTokens: usage.cacheReadTokens ?? 0,
  inputCacheMissTokens: usage.inputTokens + (usage.cacheWriteTokens ?? 0),
  outputTokens: usage.outputTokens,
})

const sameSample = (
  previous: UsageSample,
  model: string,
  buckets: UsageBuckets,
  cost: number,
): boolean =>
  previous.model === model
  && previous.cost === cost
  && previous.buckets.inputCacheHitTokens === buckets.inputCacheHitTokens
  && previous.buckets.inputCacheMissTokens === buckets.inputCacheMissTokens
  && previous.buckets.outputTokens === buckets.outputTokens

/** Credit one sample's contribution back to its own model's row. */
function subtractSample(models: UsageCostModel[], sample: UsageSample): UsageCostModel[] {
  const index = models.findIndex(row => row.model === sample.model)
  const existing = index === -1 ? undefined : models[index]
  if (existing === undefined) return models
  const credited: UsageCostModel = {
    model: sample.model,
    cost: existing.cost - sample.cost,
    inputCacheHitTokens: existing.inputCacheHitTokens - sample.buckets.inputCacheHitTokens,
    inputCacheMissTokens: existing.inputCacheMissTokens - sample.buckets.inputCacheMissTokens,
    outputTokens: existing.outputTokens - sample.buckets.outputTokens,
  }
  const nextModels = [...models]
  nextModels[index] = credited
  return nextModels
}

/**
 * Replace-or-append one sample's contribution: credit back the superseded
 * sample to the row it was added to, then add the new sample on the priced
 * model's row.
 */
function addSample(
  models: UsageCostModel[],
  model: string,
  previous: UsageSample | null,
  buckets: UsageBuckets,
  cost: number,
): UsageCostModel[] {
  const credited = previous === null ? models : subtractSample(models, previous)
  const index = credited.findIndex(row => row.model === model)
  const existing = index === -1 ? undefined : credited[index]
  const current: UsageCostModel = existing ?? {
    model,
    cost: 0,
    inputCacheHitTokens: 0,
    inputCacheMissTokens: 0,
    outputTokens: 0,
  }
  const next: UsageCostModel = {
    model,
    cost: current.cost + cost,
    inputCacheHitTokens: current.inputCacheHitTokens + buckets.inputCacheHitTokens,
    inputCacheMissTokens: current.inputCacheMissTokens + buckets.inputCacheMissTokens,
    outputTokens: current.outputTokens + buckets.outputTokens,
  }
  const nextModels = [...credited]
  if (existing === undefined) nextModels.push(next)
  else nextModels[index] = next
  return nextModels
}

const unitPriceSchema = z.object({
  inputCacheHit: z.number().nonnegative(),
  inputCacheMiss: z.number().nonnegative(),
  output: z.number().nonnegative(),
}).strict()

const modelPricingSchema = z.object({
  before: unitPriceSchema,
  peak: unitPriceSchema,
  offPeak: unitPriceSchema,
}).strict()

const scheduleSchema = z.object({
  currency: z.string().min(1),
  priceUnit: z.literal('per_1M_tokens'),
  timezone: z.string().min(1),
  effectiveFrom: z.string().min(1),
  effectiveFromMs: z.number(),
  peakRanges: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().positive()])),
  models: z.record(z.string(), modelPricingSchema),
}).strict()

const projectionSchema = z.object({
  currency: z.string().min(1),
  totalCost: z.number().nonnegative(),
  models: z.array(z.object({
    model: z.string().min(1),
    cost: z.number().nonnegative(),
    inputCacheHitTokens: z.number().int().nonnegative(),
    inputCacheMissTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }).strict()),
  schedule: scheduleSchema,
}).strict()

/**
 * Build the `usageCost` unit for one resolved schedule.
 * @param schedule - the resolved pricing schedule.
 * @param raw - the raw schedule snapshot served verbatim to clients.
 * @returns the projection definition.
 */
export function usageCostProjectionDefinition(
  schedule: ResolvedPricingSchedule,
  raw: PricingScheduleConfig,
): ProjectionDefinition<'usageCost', CostState> {
  return {
    key: 'usageCost',
    schema: projectionSchema,
    init: () => ({ models: [], last: null, currentModel: null }),
    apply: (state, event) => {
      if (event.type === 'request/header') {
        const model = event.data.header.config.model
        return state.currentModel === model ? state : { ...state, currentModel: model }
      }
      let turn: number
      let step: number
      let usage: TokenUsage
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
        ;({ turn, step } = event.data)
        usage = event.data.chunk.usage
      } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
        ;({ turn, step } = event.data)
        usage = event.data.usage
      } else {
        return state
      }
      if (state.currentModel === null) return state
      const resolved = resolveUnitPrice(schedule, state.currentModel, event.time)
      if (resolved === undefined) return state
      const buckets = bucketsFrom(usage)
      const cost = costOfUsage(buckets, resolved.price)
      const previous = state.last !== null && state.last.turn === turn && state.last.step === step
        ? state.last
        : null
      if (previous !== null && sameSample(previous, state.currentModel, buckets, cost)) return state
      return {
        models: addSample(state.models, state.currentModel, previous, buckets, cost),
        last: { turn, step, model: state.currentModel, buckets, cost },
        currentModel: state.currentModel,
      }
    },
    view: state => ({
      currency: schedule.currency,
      totalCost: state.models.reduce((sum, row) => sum + row.cost, 0),
      models: state.models,
      schedule: {
        currency: schedule.currency,
        priceUnit: schedule.priceUnit,
        timezone: schedule.timezone,
        effectiveFrom: raw.effectiveFrom,
        effectiveFromMs: schedule.effectiveFromMs,
        peakRanges: schedule.peakRanges,
        models: raw.models,
      },
    }),
    stateVersion: 2,
  }
}
