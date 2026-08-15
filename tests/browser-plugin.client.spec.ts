/**
 * dsh-cost-meter browser half on a real SlotRegistry: the plugin occupies
 * the conversation-declared `conversation.input.dock` list seat by default
 * (the portable choice every Web surface ships) and the newer
 * `conversation.input.meter` single seat when configured; an unknown seat
 * fails loud; teardown empties the seat (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { CostMeter } from '../src/client/CostMeter.tsx'
import { apply, inject } from '../src/client/index.ts'
import { resolveSeat } from '../src/client/seat.ts'

describe('dsh-cost-meter browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('resolves the seat config and rejects unknown values', () => {
    expect(resolveSeat({})).toBe('dock')
    expect(resolveSeat({ seat: 'dock' })).toBe('dock')
    expect(resolveSeat({ seat: 'meter' })).toBe('meter')
    expect(() => resolveSeat({ seat: 'nowhere' } as never)).toThrow(/unknown seat/)
  })

  async function bench(config: object = {}) {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply }, config)
    await fiber.await()
    return { ctx, slots, fiber }
  }

  it('waits for the dock declaration, registers, and unregisters on teardown', async () => {
    const b = await bench()
    expect(b.slots.entries('conversation.input.dock')).toHaveLength(0)
    b.slots.register({
      name: 'root',
      children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    const entries = b.slots.entries('conversation.input.dock')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.component).toBe(CostMeter)
    expect(entries[0]!.locale).toBe('cost')

    await b.fiber.dispose()
    expect(b.slots.entries('conversation.input.dock')).toHaveLength(0)
  })

  it('occupies the meter seat when configured', async () => {
    const b = await bench({ seat: 'meter' })
    expect(b.slots.entries('conversation.input.meter')).toHaveLength(0)
    b.slots.register({
      name: 'root',
      children: { 'conversation.input.meter': { kind: 'single', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    const entries = b.slots.entries('conversation.input.meter')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.component).toBe(CostMeter)
  })
})
