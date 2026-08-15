/**
 * Self-contained stylesheet for the cost panel. This package ships its own
 * bundle outside the harness build, so it cannot ride the harness CSS-module
 * pipeline: the rules live as one literal string with a `dcm-` class prefix
 * and are injected exactly once at plugin activation (idempotent — an unload
 * leaves the sheet; the panel never re-registers it).
 * @module dsh-cost-meter/client/styles
 */
/** The class map the panel renders with (stable names, no hashing). */
export declare const styles: {
    readonly root: "dcm-root";
    readonly trigger: "dcm-trigger";
    readonly panel: "dcm-panel";
    readonly header: "dcm-header";
    readonly title: "dcm-title";
    readonly figures: "dcm-figures";
    readonly models: "dcm-models";
    readonly model: "dcm-model";
    readonly modelRow: "dcm-model-row";
    readonly modelName: "dcm-model-name";
    readonly modelCost: "dcm-model-cost";
    readonly tokens: "dcm-tokens";
    readonly tokenRow: "dcm-token-row";
    readonly tokenValue: "dcm-token-value";
    readonly pricing: "dcm-pricing";
    readonly pricingHeader: "dcm-pricing-header";
    readonly pricingTitle: "dcm-pricing-title";
    readonly officialTag: "dcm-official-tag";
    readonly table: "dcm-table";
    readonly tableModel: "dcm-table-model";
    readonly num: "dcm-num";
    readonly notice: "dcm-notice";
    readonly noticeText: "dcm-notice-text";
    readonly noticeTag: "dcm-notice-tag";
};
/**
 * Inject the stylesheet once per document (idempotent across hot reloads).
 */
export declare function injectStyles(): void;
