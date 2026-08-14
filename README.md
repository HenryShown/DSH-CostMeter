# dsh-cost-meter

English | [中文](README.zh.md)

A DeepSeek Harness community plugin: it folds logged provider usage into a
per-session currency cost under a configurable pricing schedule, and serves it
through the session-projection seam as the `usageCost` projection unit. The
web composer reads the same key to show a session cost chip and a
current-price panel.

## Installation

```bash
dsh plugin --profile <name> add github:HenryShown/DSH-CostMeter
```

The command installs the package into the profile and mounts its composition
row automatically (the package declares `dsh.bundle.patch` contributing
`cordis.patch.yml`). The session-projection registry ships with `dsh-base`; a
composition without it must add `@deepseek-ai/dsh-session-projection`
explicitly.

## Configuration

Every field defaults to the shipped DeepSeek V4 schedule, so mounting the
plugin with no config prices V4 Flash and V4 Pro correctly. Rates are
currency per one million tokens; unknown keys fail at load. Providing
`models` replaces the whole table: a partial `models` map drops the shipped
entries for the other models.

```yaml
- id: cost-meter
  name: 'dsh-cost-meter'
  config:
    currency: CNY
    priceUnit: per_1M_tokens
    timezone: Asia/Shanghai
    effectiveFrom: '2026-08-17T00:00:00+08:00'
    peakPeriods:
      - '09:00-12:00'
      - '14:00-18:00'
    models:
      deepseek-v4-flash:
        before: { inputCacheHit: 0.02, inputCacheMiss: 1.00, output: 2.00 }
        peak: { inputCacheHit: 0.10, inputCacheMiss: 3.00, output: 9.00 }
        offPeak: { inputCacheHit: 0.05, inputCacheMiss: 1.50, output: 4.50 }
      deepseek-v4-pro:
        before: { inputCacheHit: 0.025, inputCacheMiss: 3.00, output: 6.00 }
        peak: { inputCacheHit: 0.30, inputCacheMiss: 9.00, output: 27.00 }
        offPeak: { inputCacheHit: 0.15, inputCacheMiss: 4.50, output: 13.50 }
```

## Pricing rules

One usage sample is priced at its own event time. Before `effectiveFrom`
(compared in the configured timezone) the flat `before` tier applies; from
that instant the `peak` tier applies inside each `peakPeriods` interval and
`offPeak` everywhere else. Intervals are end-exclusive local wall time
(`HH:MM-HH:MM`, `24:00` allowed as an end).

The three billing buckets are disjoint: cache-hit input is `cacheReadTokens`,
cache-miss input is `inputTokens + cacheWriteTokens`, and output is
`outputTokens`. Cost is the three products divided by 1,000,000.

The fold mirrors dsh-token-meter's usage-sample replacement invariant: the
assembled `assistant/message` usage replaces the stream's `assistant/chunk`
usage for the same `(turn, step)`, so a sample is never counted twice. A
replacement credits the superseded sample back to its own model's row, so a
mid-step model switch moves the step's usage to the new model instead of
double counting it. Each sample is priced under the model recorded by the
newest `request/header`; a sample with no preceding header, or under an
unpriced model, contributes nothing.

## Projection

The `usageCost` unit value carries `currency`, `totalCost`, one
`models` row per priced model with its bucket tokens and `cost`, and a
client-facing `schedule` snapshot whose `peakRanges` and `effectiveFromMs`
are already parsed. Client code reads the value through `useProjection`
after importing the key merge:

```ts
import type {} from 'dsh-cost-meter/client'
```

## Composition

The plugin requires `ctx.sessionProjections` and registers its unit for the
life of the plugin fiber, so unloading removes the key. This package's own
patch layer mounts one `cost-meter` row; a hand-written minimal composition
is:

```yaml
- name: '@deepseek-ai/dsh-session-projection'
- name: 'dsh-cost-meter'
```

## Development

The peer packages (`@deepseek-ai/*`) are provided by a DeepSeek Harness
installation, not by the npm registry, so run the full test suite inside a
DSH checkout (place this repository under the checkout's workspace and run
`vitest run`) or link the peer packages locally:

```bash
pnpm install
pnpm test -- tests/pricing.spec.ts   # pure-pricing suite runs standalone
```

Sources live in `src/`; the `lib/` build output is committed so the package
installs and loads without a build step.

## Known Limitations and Deferred Work

- **Unpriced models contribute nothing** — usage logged before the first
  `request/header`, or under a model id absent from `models`, is invisible to
  the total rather than guessed from another tier.
- **Cost is float64, not a billing record** — figures are rounded to four
  decimals for display; provider invoices remain the authoritative
  accounting.
- **The UI current-price tier tracks the client clock** — the billed totals
  are always the host fold, but the panel's tier label for the display's
  "now" is computed in the browser and refreshes every thirty seconds while
  open.
- **The schedule is deployment config, not user settings** — changing rates
  or periods means editing the plugin row in cordis.yml, not a settings UI.
