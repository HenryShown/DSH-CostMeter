/**
 * REAL-composition proof: the shipped YAML shape (session + projection
 * registry + cost-meter) boots through the vendored Loader, the function
 * plugin's namespace survives (no default export), and a logged usage sample
 * serves a priced `usageCost` row through the composed registry.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as CostMeter from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-cost-meter-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['dsh-cost-meter', CostMeter],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the shipped cost-meter YAML shape and serves a priced usageCost row', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: 'dsh-cost-meter'",
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const session = loaded.sessions.create(SessionId('composed'))
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'deepseek-v4-flash' } },
      reason: 'initial',
    })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        source: { kind: 'model', provider: 'mock', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 0, cacheReadTokens: 5, cacheWriteTokens: 7, outputTokens: 3 },
    }, { surfaceOp: 'append', sourceEventSeqs: [] })

    const value = loaded.sessionProjections.snapshot(session).values.usageCost
    expect(value?.currency).toBe('CNY')
    expect(value?.models).toEqual([expect.objectContaining({
      model: 'deepseek-v4-flash',
      inputCacheHitTokens: 5,
      inputCacheMissTokens: 7,
      outputTokens: 3,
    })])
    expect(value?.totalCost).toBeGreaterThan(0)
  })

  it('keeps the function-plugin namespace free of a default export', () => {
    expect('default' in CostMeter).toBe(false)
  })
})
