/**
 * Build configuration for the package's three artifacts:
 * - lib/index.js / lib/invariant.js: the host half (ESM, node platform),
 *   packed from the tsc-emitted lib/types sources;
 * - lib/client.js: the browser half (CJS closure for the harness module
 *   loader), packed from src/client directly (tsdown transforms TSX).
 * The committed lib/ is what installs — consumers never build.
 */
import { defineConfig } from 'tsdown'

/** Externals resolved by the harness at runtime (module table / react). */
const CLIENT_EXTERNAL = (id: string): boolean =>
  id.startsWith('@deepseek-ai/') || id === 'react' || id === 'react/jsx-runtime'

export default defineConfig([
  {
    name: 'dsh-cost-meter',
    entry: ['src/index.ts', 'src/invariant.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    fixedExtension: true,
    outputOptions: {
      entryFileNames: '[name].js',
    },
  },
  {
    name: 'dsh-cost-meter/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    sourcemap: false,
    external: CLIENT_EXTERNAL,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-cost-meter", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
