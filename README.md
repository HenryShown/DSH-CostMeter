# dsh-cost-meter

English | [中文](README.zh.md)

A DeepSeek Harness plugin that folds logged provider usage into a
per-session currency cost and shows it in the Web composer: a **cost pill**
next to the send button opens a panel with the session total, per-model
totals and token buckets, the live per-million **rate table** for the tier
currently in effect, and the peak/off-peak cutover notice. The host half
also refreshes the **official DeepSeek pricing page** hourly and the panel
prefers that snapshot over the local configuration.

One package, both halves:

- **Host half** — registers the `usageCost` session-projection unit and
  serves the official-price snapshot on `/plugins/dsh-cost-meter/prices.json`
  (surfaces without a web server keep the projection only).
- **Browser half** (`./client`) — renders the composer pill and panel; the
  seat is configurable (`dock` by default, `meter` on newer harnesses).

## Installation

```bash
dsh plugin --profile <name> add github:HenryShown/DSH-CostMeter
```

The command installs the package into the profile and mounts its
composition row automatically (the package declares `dsh.bundle.patch`,
whose `cordis.patch.yml` inserts the row). The session-projection registry
ships with `dsh-base`; a composition without it must add
`@deepseek-ai/dsh-session-projection` explicitly.

After installing, restart the Web server (a new bundle layer takes effect
on the next boot), open a session, and you should see the cost pill next to
the send button. Verification:

```bash
# The composition contains the row (no "entry not found" warnings):
dsh --profile <name> --dump-config
# The host half serves the official snapshot (needs outbound HTTPS):
curl -s http://127.0.0.1:3090/plugins/dsh-cost-meter/prices.json
```

## What the panel shows

- **Pill**: the session total (`¥2.9909`), live via the `usageCost`
  projection; hover reads `费用 ¥2.9909`.
- **Panel**: the emphasized session total; per-model totals with token
  buckets (`输入 · 缓存命中 72.1M`); the rate table
  `实时费率/1M tokens` with `模型 / 缓存命中 / 未命中 / 输出` columns for
  the tier currently in effect; and the cutover notice
  (`◷ 8 月 17 日起启用峰谷计价`) tagged `即将生效` until it passes.
- **Live tier**: the displayed tier resolves on the client clock against
  the schedule's cutover and peak ranges and re-resolves every 30 seconds
  while the panel is open.
- **Official sync**: when the host half has a snapshot, the table and the
  cutover facts come from the official pricing page and the panel shows
  `官方同步 HH:MM`; any fetch/parse failure falls back to the local
  configuration silently.

## Configuration

Every host field defaults to the shipped DeepSeek V4 schedule, so mounting
the plugin with no config prices V4 Flash and V4 Pro correctly. Rates are
currency per one million tokens; unknown keys fail at load. Providing
`models` replaces the whole table: a partial `models` map drops the shipped
entries for the other models. `pricingUrl`, `refreshIntervalMs`, and
`requestTimeoutMs` control the official-price feed.

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
    pricingUrl: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
    refreshIntervalMs: 3600000
    requestTimeoutMs: 10000
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

The browser half selects its composer seat through its own `config.seat`:

```yaml
- id: cost-meter
  name: 'dsh-cost-meter'
  config:
    seat: dock   # default; also accepts: meter
```

- `dock` — the list strip above the composer (`conversation.input.dock`).
  Every Web surface ships it; this is the portable default.
- `meter` — the named seat immediately right of the context-occupancy ring
  (`conversation.input.meter`), which only newer ui-conversation builds
  declare. On older builds the contribution simply never renders.

## Pricing rules

One usage sample is priced at its own event time. Before `effectiveFrom`
(compared in the configured timezone) the flat `before` tier applies; from
that instant the `peak` tier applies inside each `peakPeriods` interval and
`offPeak` everywhere else. Intervals are end-exclusive local wall time
(`HH:MM-HH:MM`, `24:00` allowed as an end).

The three billing buckets are disjoint: cache-hit input is
`cacheReadTokens`, cache-miss input is `inputTokens + cacheWriteTokens`,
and output is `outputTokens`. Cost is the three products divided by
1,000,000.

The fold mirrors dsh-token-meter's usage-sample replacement invariant: the
assembled `assistant/message` usage replaces the stream's
`assistant/chunk` usage for the same `(turn, step)`, so a sample is never
counted twice. A replacement credits the superseded sample back to its own
model's row, so a mid-step model switch moves the step's usage to the new
model instead of double counting it. Each sample is priced under the model
recorded by the newest `request/header`; a sample with no preceding header,
or under an unpriced model, contributes nothing.

## Official live-rate feed

DeepSeek publishes no structured pricing API, so the host half scrapes the
official pricing docs page (Docusaurus HTML) and parses it strictly: every
peak/off-peak bucket for both shipped models must resolve or the whole
parse fails — a wrong price is worse than falling back to the local
configuration. A failed fetch or parse keeps the last good snapshot; the
route answers `{ "ok": false }` with HTTP 404 while no snapshot exists.
The feed refreshes hourly and re-fetches nothing while idle (the interval
timer is unref'd).

## Development

The peer packages (`@deepseek-ai/*`) are provided by a DeepSeek Harness
installation, not by the npm registry. Place this repository under the
checkout's workspace (`packages/community/dsh-cost-meter`) so the
workspace link resolves the peers, then:

```bash
pnpm install
pnpm exec vitest run packages/community/dsh-cost-meter   # from the checkout root
pnpm --filter dsh-cost-meter exec tsc -p tsconfig.build.json
pnpm --filter dsh-cost-meter exec tsdown
```

The committed `lib/` is what installs — consumers never build. The bundle
is self-contained: the browser half injects its own stylesheet (no CSS
pipeline dependency) and externalizes only the harness platform modules.

## Known Limitations and Deferred Work

- **Unpriced models contribute nothing** — usage logged before the first
  `request/header`, or under a model id absent from `models`, is invisible
  to the total rather than guessed from another tier.
- **Cost is float64, not a billing record** — figures are rounded to four
  decimals for display; provider invoices remain the authoritative
  accounting.
- **The displayed tier tracks the client clock** — the billed totals are
  always the host fold (priced per event time), but the panel's tier label
  and rate table resolve against the browser's clock and timezone data; a
  skewed client clock shows the wrong tier while the totals stay correct.
- **The official snapshot parses HTML** — a page redesign makes the strict
  parser fail closed, and the panel then shows the locally configured
  schedule until the parser catches up.
- **The schedule is deployment config, not user settings** — changing rates
  or periods means editing the plugin row in cordis.yml, not a settings UI.
