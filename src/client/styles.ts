/**
 * Self-contained stylesheet for the cost panel. This package ships its own
 * bundle outside the harness build, so it cannot ride the harness CSS-module
 * pipeline: the rules live as one literal string with a `dcm-` class prefix
 * and are injected exactly once at plugin activation (idempotent — an unload
 * leaves the sheet; the panel never re-registers it).
 * @module dsh-cost-meter/client/styles
 */

const CSS = `
.dcm-root { position: relative; display: inline-flex; }
.dcm-trigger {
  display: inline-flex;
  align-items: center;
  flex: none;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.dcm-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dcm-trigger:disabled { opacity: 0.4; cursor: default; }
.dcm-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  z-index: 100;
  box-sizing: border-box;
  width: 320px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-inverted);
  border-radius: 12px;
  background: var(--dsw-specific-menu);
  box-shadow: var(--dsw-shadow-lv3);
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}
.dcm-header { display: flex; align-items: center; gap: 6px; }
.dcm-title { color: var(--dsw-alias-label-tertiary); }
.dcm-figures {
  margin-left: auto;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
}
.dcm-models { margin: 10px 0 0; }
.dcm-model { padding: 2px 0; }
.dcm-model-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dcm-model-name { color: var(--dsw-alias-label-primary); }
.dcm-model-cost { margin: 0; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.dcm-tokens { display: flex; flex-direction: column; color: var(--dsw-alias-label-tertiary); }
.dcm-token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  line-height: 18px;
  padding: 1px 0;
}
.dcm-token-value { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.dcm-pricing { margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dcm-pricing-header { display: flex; align-items: baseline; gap: 8px; }
.dcm-pricing-title { font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dcm-official-tag {
  margin-left: auto;
  font-size: 10px;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.dcm-table { width: 100%; margin-top: 6px; border-collapse: collapse; font-size: 12px; line-height: 20px; }
.dcm-table th { padding: 1px 0; text-align: left; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.dcm-table th:not(:first-child) { text-align: right; }
.dcm-table td { padding: 1px 0; color: var(--dsw-alias-label-secondary); }
.dcm-table-model { font-weight: 500; }
.dcm-num { text-align: right; font-variant-numeric: tabular-nums; }
.dcm-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-state-business-tertiary);
  color: var(--dsw-alias-state-business-label);
  font-size: 12px;
  line-height: 18px;
}
.dcm-notice-text { min-width: 0; }
.dcm-notice-tag {
  margin-left: auto;
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 16px;
}
`

/** The class map the panel renders with (stable names, no hashing). */
export const styles = {
  root: 'dcm-root',
  trigger: 'dcm-trigger',
  panel: 'dcm-panel',
  header: 'dcm-header',
  title: 'dcm-title',
  figures: 'dcm-figures',
  models: 'dcm-models',
  model: 'dcm-model',
  modelRow: 'dcm-model-row',
  modelName: 'dcm-model-name',
  modelCost: 'dcm-model-cost',
  tokens: 'dcm-tokens',
  tokenRow: 'dcm-token-row',
  tokenValue: 'dcm-token-value',
  pricing: 'dcm-pricing',
  pricingHeader: 'dcm-pricing-header',
  pricingTitle: 'dcm-pricing-title',
  officialTag: 'dcm-official-tag',
  table: 'dcm-table',
  tableModel: 'dcm-table-model',
  num: 'dcm-num',
  notice: 'dcm-notice',
  noticeText: 'dcm-notice-text',
  noticeTag: 'dcm-notice-tag',
} as const

let injected = false

/**
 * Inject the stylesheet once per document (idempotent across hot reloads).
 */
export function injectStyles(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-cost-meter'
  tag.textContent = CSS
  document.head.appendChild(tag)
}
