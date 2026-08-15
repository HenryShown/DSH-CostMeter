# AGENTS.md

Agent-oriented installation and maintenance notes for this repository.
Human users can follow [README.md](README.md); this file spells out the
exact commands and verification steps an agent should run.

## What this repository is

One dual-face DeepSeek Harness plugin package, `dsh-cost-meter`:

- host half (`src/index.ts`) — the `usageCost` session-projection unit plus
  the official-price feed (route `/plugins/dsh-cost-meter/prices.json`);
- browser half (`src/client/`) — the composer cost pill and panel
  (`dsh.client` in package.json, bundle `lib/client.js`);
- `cordis.patch.yml` — the bundle patch that inserts the composition row
  (insert form, required by current harness patch semantics).

The committed `lib/` is the install payload; consumers never build.

## Install into a harness profile

```bash
dsh plugin --profile <name> add github:HenryShown/DSH-CostMeter
```

For a local checkout instead of GitHub:

```bash
dsh plugin --profile <name> add "file:<absolute path to this repository>"
```

Both forms reconcile the profile's `dsh.profile.bundles` automatically.

## Verify the installation

```bash
# 1. The composition carries the row without warnings:
dsh --profile <name> --dump-config
#    Expected: a "# == dsh-cost-meter" layer with:
#    - id: cost-meter
#      name: dsh-cost-meter
#    and NO `patch: entry "cost-meter" not found` warning.

# 2. Boot smoke (any free port) and check the endpoints:
dsh --profile <name> --port <port>
curl -s http://127.0.0.1:<port>/plugins/dsh-cost-meter/client.js        # HTTP 200, JS bundle
curl -s http://127.0.0.1:<port>/plugins/dsh-cost-meter/prices.json      # {"ok":true,...} after the first fetch (needs outbound HTTPS)
```

The server must be restarted after installation: a new bundle layer takes
effect on the next boot, and the official-price feed lives in the host
half.

## Compatibility notes

- The session-projection registry ships with `dsh-base`; compositions
  without it need `@deepseek-ai/dsh-session-projection`.
- The browser half defaults to the `conversation.input.dock` seat (every
  Web surface has it). `config.seat: meter` targets
  `conversation.input.meter`, declared only by newer ui-conversation
  builds; on older builds that contribution never renders.
- The official-price feed requires the `webServer` service (Web surface);
  headless surfaces keep the projection only.
- Outbound HTTPS to `api-docs.deepseek.com` is required for the official
  snapshot; without it the panel falls back to the local configuration.

## Development inside a harness checkout

```bash
# Place this repository at packages/community/dsh-cost-meter, then:
pnpm install
pnpm exec vitest run packages/community/dsh-cost-meter          # tests (run from the checkout root)
pnpm --filter dsh-cost-meter exec tsc -p tsconfig.build.json    # type declarations
pnpm --filter dsh-cost-meter exec tsdown                        # lib/ bundles
```

`pnpm exec tsc -p tsconfig.json` typechecks sources and tests. After any
source change, rebuild `lib/` and commit it — installs consume `lib/`
only.

## Releasing

```bash
# After changing sources, docs, or the patch file:
pnpm --filter dsh-cost-meter exec tsc -p tsconfig.build.json
pnpm --filter dsh-cost-meter exec tsdown
git add -A
git commit -m "<message>"
git push
```

Keep the built `lib/` and `cordis.patch.yml` in sync with `src/`; never
commit credentials, personal paths, or API keys — the repository is public.
