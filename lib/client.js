window.__ModuleLoader__.load({
	id: "dsh-cost-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/prices.ts
		/** Local route the node half serves and the browser half reads. */
		const PRICES_ENDPOINT = "/plugins/dsh-cost-meter/prices.json";
		//#endregion
		//#region src/client/format.ts
		/**
		* Pure display formatting for the usageCost projection value.
		* @module dsh-cost-meter/client/format
		*/
		/**
		* The currency's display symbol prefix. CNY and USD use their symbols; any
		* other code is spelled out before the amount.
		* @param currency - the schedule's currency code.
		* @returns the symbol prefix, e.g. `¥` or `EUR `.
		*/
		function currencySymbol(currency) {
			return currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency} `;
		}
		/**
		* Format one currency amount for display, rounded to four decimals (the
		* cost-meter fold's display precision).
		* @param currency - the schedule's currency code.
		* @param amount - the amount to format.
		* @returns the display string, e.g. `¥1.0796` or `EUR 1.2500`.
		*/
		function formatCost(currency, amount) {
			return `${currencySymbol(currency)}${amount.toFixed(4)}`;
		}
		/**
		* Abbreviate a token count for the panel rows: millions as one decimal
		* (`10.1M`), thousands as a whole number from 100K up (`151K`) and one
		* decimal below (`62.6K`), plain integers underneath.
		* @param tokens - the token count to format.
		* @returns the display string.
		*/
		function formatTokens(tokens) {
			if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`;
			if (tokens >= 1e3) {
				const kilo = tokens / 1e3;
				return kilo >= 100 ? `${Math.round(kilo)}K` : `${kilo.toFixed(1)}K`;
			}
			return String(tokens);
		}
		/**
		* Render one per-million price exactly as the schedule carries it (no fixed
		* decimals: `0.02`, `1`, `0.025` stay as they are).
		* @param price - the price per one million tokens.
		* @returns the plain number string.
		*/
		function formatPrice(price) {
			return String(price);
		}
		/**
		* Format an epoch-millisecond instant as the local wall-clock `HH:MM` (the
		* official-sync annotation shows no date: the panel's cutover notice already
		* carries the calendar facts).
		* @param ms - the instant to format.
		* @returns the local `HH:MM` string.
		*/
		function formatClockMs(ms) {
			const date = new Date(ms);
			const pad = (value) => String(value).padStart(2, "0");
			return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
		/**
		* Normalize the dash-separated model segments: `v4` promotes to `V4`, every
		* other segment is title-cased.
		* @param bare - the model id without any vendor prefix.
		* @returns the normalized segment string.
		*/
		function normalizeModelSegments(bare) {
			return bare.split("-").map((part) => part === "v4" ? "V4" : `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("-");
		}
		/**
		* Render a model id as the branded display name: the `deepseek-` vendor
		* prefix becomes the `DeepSeek-` brand prefix and the segments are
		* normalized (`deepseek-v4-pro` → `DeepSeek-V4-Pro`).
		* @param model - the model id from the schedule.
		* @returns the branded display name.
		*/
		function formatModelName(model) {
			const branded = model.startsWith("deepseek-");
			const bare = branded ? model.slice(9) : model;
			return branded ? `DeepSeek-${normalizeModelSegments(bare)}` : normalizeModelSegments(bare);
		}
		/**
		* Render a model id as the price table's compact name: the vendor prefix
		* drops and the segments are normalized (`deepseek-v4-flash` → `V4-Flash`).
		* @param model - the model id from the schedule.
		* @returns the table's model label.
		*/
		function formatModelShortName(model) {
			return normalizeModelSegments(model.startsWith("deepseek-") ? model.slice(9) : model);
		}
		/**
		* Parse the schedule's ISO cutover into its calendar parts (the panel only
		* shows the date, never the wall time).
		* @param effectiveFrom - the configured ISO cutover string.
		* @returns the year, month (1-12), and day of the cutover.
		*/
		function parseEffectiveFrom(effectiveFrom) {
			return {
				year: Number(effectiveFrom.slice(0, 4)),
				month: Number(effectiveFrom.slice(5, 7)),
				day: Number(effectiveFrom.slice(8, 10))
			};
		}
		/**
		* The cutover string's trailing UTC offset in minutes (its `±HH:MM`
		* suffix); 0 when the string carries none.
		* @param effectiveFrom - the configured ISO cutover string.
		* @returns the offset in minutes.
		*/
		function parseOffsetMinutes(effectiveFrom) {
			const match = /([+-])(\d{2}):(\d{2})$/.exec(effectiveFrom);
			if (match === null) return 0;
			return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
		}
		/**
		* The wall-clock minute of day (0-1439) in the schedule's timezone for one
		* instant. The IANA zone resolves through `Intl`; an invalid zone name falls
		* back to the cutover string's own offset.
		* @param timezone - the configured IANA timezone.
		* @param fallbackOffsetMinutes - offset used when the zone cannot resolve.
		* @param nowMs - the instant to read.
		* @returns the wall-clock minute of day.
		*/
		function wallClockMinuteOfDay(timezone, fallbackOffsetMinutes, nowMs) {
			try {
				const parts = new Intl.DateTimeFormat("en-GB", {
					timeZone: timezone,
					hour: "2-digit",
					minute: "2-digit",
					hour12: false
				}).formatToParts(new Date(nowMs));
				const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
				const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
				return (hour === 24 ? 0 : hour) * 60 + minute;
			} catch {
				const wall = new Date(nowMs + fallbackOffsetMinutes * 6e4);
				return wall.getUTCHours() * 60 + wall.getUTCMinutes();
			}
		}
		/**
		* Resolve the pricing tier in effect at one instant under the configured
		* schedule: flat `before` until the cutover, then `peak` inside any peak
		* interval (end-exclusive local wall time) and `offPeak` everywhere else.
		* @param schedule - the schedule snapshot (cutover plus peak ranges).
		* @param nowMs - the instant to resolve.
		* @returns the tier that prices that instant.
		*/
		function resolveTier(schedule, nowMs) {
			if (nowMs < schedule.effectiveFromMs) return "before";
			const minute = wallClockMinuteOfDay(schedule.timezone, parseOffsetMinutes(schedule.effectiveFrom), nowMs);
			for (const [start, end] of schedule.peakRanges) if (minute >= start && minute < end) return "peak";
			return "offPeak";
		}
		//#endregion
		//#region src/client/styles.ts
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
`;
		/** The class map the panel renders with (stable names, no hashing). */
		const styles = {
			root: "dcm-root",
			trigger: "dcm-trigger",
			panel: "dcm-panel",
			header: "dcm-header",
			title: "dcm-title",
			figures: "dcm-figures",
			models: "dcm-models",
			model: "dcm-model",
			modelRow: "dcm-model-row",
			modelName: "dcm-model-name",
			modelCost: "dcm-model-cost",
			tokens: "dcm-tokens",
			tokenRow: "dcm-token-row",
			tokenValue: "dcm-token-value",
			pricing: "dcm-pricing",
			pricingHeader: "dcm-pricing-header",
			pricingTitle: "dcm-pricing-title",
			officialTag: "dcm-official-tag",
			table: "dcm-table",
			tableModel: "dcm-table-model",
			num: "dcm-num",
			notice: "dcm-notice",
			noticeText: "dcm-notice-text",
			noticeTag: "dcm-notice-tag"
		};
		let injected = false;
		/**
		* Inject the stylesheet once per document (idempotent across hot reloads).
		*/
		function injectStyles() {
			if (injected || typeof document === "undefined") return;
			injected = true;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-cost-meter";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/CostMeter.tsx
		/**
		* Composer session-cost meter: an amount pill carrying the session total,
		* fed by the `usageCost` projection, with a click-open panel that shows the
		* per-model totals, token buckets, the live-rate table for the tier
		* currently in effect (resolved on the client clock, refreshed while the
		* panel is open), and the peak/off-peak cutover notice. The price table
		* prefers the official snapshot the host half serves and falls back to the
		* locally configured schedule; a successful official read is annotated with
		* its sync time. Renders nothing until the host cost-meter unit serves a
		* value; the panel mirrors the context meter's menu surface.
		*/
		/** How often an open panel re-resolves the price tier (client-clock tracking). */
		const TIER_REFRESH_MS = 3e4;
		/** The official DeepSeek pricing page publishes rates in CNY. */
		const OFFICIAL_CURRENCY = "CNY";
		const sameRanges = (left, right) => left.length === right.length && left.every((range, index) => range[0] === right[index]?.[0] && range[1] === right[index]?.[1]);
		const completePrice = (price) => price !== void 0 && Number.isFinite(price.inputCacheHit) && price.inputCacheHit >= 0 && Number.isFinite(price.inputCacheMiss) && price.inputCacheMiss >= 0 && Number.isFinite(price.output) && price.output >= 0;
		/**
		* Accept an official tier only when it uses the same currency and schedule
		* facts as the host projection and prices every displayed model.
		*/
		function compatibleOfficialTier(cost, official, tier) {
			if (official === null || cost.currency !== OFFICIAL_CURRENCY || official.prices.timezone !== cost.schedule.timezone || official.prices.effectiveFromMs !== cost.schedule.effectiveFromMs || !sameRanges(official.prices.peakRanges, cost.schedule.peakRanges)) return void 0;
			const prices = official.prices[tier];
			if (prices === void 0) return void 0;
			return Object.keys(cost.schedule.models).every((model) => completePrice(prices[model])) ? prices : void 0;
		}
		/**
		* The session-cost meter over the host-computed `usageCost` projection.
		* Renders nothing while the capability is absent; otherwise shows a pill
		* badge whose click-open panel breaks the total down per priced model.
		*/
		function CostMeter({ useProjection, t, locked = false }) {
			injectStyles();
			const cost = useProjection("usageCost");
			const [open, setOpen] = (0, react.useState)(false);
			const [, setTick] = (0, react.useState)(0);
			const [official, setOfficial] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const available = cost !== void 0;
			(0, react.useEffect)(() => {
				if (!available && open) setOpen(false);
			}, [available, open]);
			(0, react.useEffect)(() => {
				if (!open || !available) return;
				const timer = setInterval(() => {
					setTick((tick) => tick + 1);
				}, TIER_REFRESH_MS);
				return () => {
					clearInterval(timer);
				};
			}, [available, open]);
			(0, react.useEffect)(() => {
				if (!open || !available) return;
				const controller = new AbortController();
				let active = true;
				fetch(PRICES_ENDPOINT, { signal: controller.signal }).then(async (response) => {
					if (!response.ok) return null;
					const body = await response.json();
					return body.ok ? {
						fetchedAt: body.fetchedAt,
						prices: body.prices
					} : null;
				}).then((value) => {
					if (active) setOfficial(value);
				}).catch(() => {
					if (active) setOfficial(null);
				});
				return () => {
					active = false;
					controller.abort();
				};
			}, [available, open]);
			(0, react.useEffect)(() => {
				if (!open || !available) return;
				const onPointerDown = (e) => {
					if (e.target instanceof Node && rootRef.current?.contains(e.target) === true) return;
					setOpen(false);
				};
				const onKeyDown = (e) => {
					if (e.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [available, open]);
			if (cost === void 0) return null;
			const amount = formatCost(cost.currency, cost.totalCost);
			const reading = `${t("dock.label")} ${amount}`;
			const symbol = currencySymbol(cost.currency);
			const tier = resolveTier(cost.schedule, Date.now());
			const officialTier = compatibleOfficialTier(cost, official, tier);
			const cutover = parseEffectiveFrom(cost.schedule.effectiveFrom);
			const crossYear = cutover.year !== (/* @__PURE__ */ new Date()).getFullYear();
			const effectiveKey = crossYear ? "panel.effective.crossYear" : "panel.effective";
			const effectiveArgs = crossYear ? {
				year: String(cutover.year),
				month: String(cutover.month),
				day: String(cutover.day)
			} : {
				month: String(cutover.month),
				day: String(cutover.day)
			};
			const effectiveTagKey = cost.schedule.effectiveFromMs > Date.now() ? "panel.effective.tag.upcoming" : "panel.effective.tag.active";
			const priceOf = (model, bucket) => officialTier?.[model]?.[bucket] ?? cost.schedule.models[model]?.[tier][bucket] ?? 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: styles.root,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: reading,
					side: "top",
					delayMs: 200,
					disabled: open,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: styles.trigger,
						"aria-label": reading,
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						disabled: locked,
						onClick: () => {
							setOpen(!open);
						},
						children: amount
					})
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.panel,
					role: "dialog",
					"aria-label": t("panel.title"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.header,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.title,
								children: t("panel.total")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.figures,
								children: formatCost(cost.currency, cost.totalCost)
							})]
						}),
						cost.models.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
							className: styles.models,
							children: cost.models.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.model,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.modelRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
										className: styles.modelName,
										children: formatModelName(row.model)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
										className: styles.modelCost,
										children: formatCost(cost.currency, row.cost)
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.tokens,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: styles.tokenRow,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.tokens.hit") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: styles.tokenValue,
												children: formatTokens(row.inputCacheHitTokens)
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: styles.tokenRow,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.tokens.miss") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: styles.tokenValue,
												children: formatTokens(row.inputCacheMissTokens)
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: styles.tokenRow,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.tokens.output") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: styles.tokenValue,
												children: formatTokens(row.outputTokens)
											})]
										})
									]
								})]
							}, row.model))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.pricing,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.pricingHeader,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.pricingTitle,
									children: t("panel.pricing.title")
								}), official !== null && officialTier !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.officialTag,
									children: t("panel.pricing.official", { time: formatClockMs(official.fetchedAt) })
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: styles.table,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("panel.pricing.model") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("panel.pricing.hit") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("panel.pricing.miss") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("panel.pricing.output") })
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: Object.entries(cost.schedule.models).map(([model]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: styles.tableModel,
										children: formatModelShortName(model)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: styles.num,
										children: `${symbol}${formatPrice(priceOf(model, "inputCacheHit"))}`
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: styles.num,
										children: `${symbol}${formatPrice(priceOf(model, "inputCacheMiss"))}`
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: styles.num,
										children: `${symbol}${formatPrice(priceOf(model, "output"))}`
									})
								] }, model)) })]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.notice,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.noticeText,
								children: t(effectiveKey, effectiveArgs)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.noticeTag,
								children: t(effectiveTagKey)
							})]
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `cost` namespace dictionaries (the composer meter's copy). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"dock.label": "费用",
			"panel.title": "会话费用",
			"panel.total": "本会话费用",
			"panel.tokens.hit": "输入 · 缓存命中",
			"panel.tokens.miss": "输入 · 缓存未命中",
			"panel.tokens.output": "输出",
			"panel.pricing.title": "实时费率/1M tokens",
			"panel.pricing.official": "官方同步 {time}",
			"panel.pricing.model": "模型",
			"panel.pricing.hit": "缓存命中",
			"panel.pricing.miss": "未命中",
			"panel.pricing.output": "输出",
			"panel.effective": "◷ {month} 月 {day} 日起启用峰谷计价",
			"panel.effective.crossYear": "◷ {year} 年 {month} 月 {day} 日起启用峰谷计价",
			"panel.effective.tag.upcoming": "即将生效",
			"panel.effective.tag.active": "已生效"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"dock.label": "Cost",
			"panel.title": "Session cost",
			"panel.total": "Session cost total",
			"panel.tokens.hit": "Input · cache hit",
			"panel.tokens.miss": "Input · cache miss",
			"panel.tokens.output": "Output",
			"panel.pricing.title": "Live rate/1M tokens",
			"panel.pricing.official": "Official · {time}",
			"panel.pricing.model": "Model",
			"panel.pricing.hit": "Cache hit",
			"panel.pricing.miss": "Miss",
			"panel.pricing.output": "Output",
			"panel.effective": "◷ Peak/off-peak pricing starts {month}/{day}",
			"panel.effective.crossYear": "◷ Peak/off-peak pricing starts {month}/{day}/{year}",
			"panel.effective.tag.upcoming": "Upcoming",
			"panel.effective.tag.active": "Active"
		};
		//#endregion
		//#region src/client/seat.ts
		/**
		* Resolve the configured seat, rejecting unknown values loud.
		* @param config - the validated plugin config.
		* @returns the seat name.
		*/
		function resolveSeat(config) {
			const seat = config.seat ?? "meter";
			if (seat !== "dock" && seat !== "meter") throw new Error(`dsh-cost-meter: unknown seat ${JSON.stringify(seat)} — expected "dock" or "meter"`);
			return seat;
		}
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "cost";
		/** Required services: the seat's slot registry and the locale registry. */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: the CostMeter entry on the configured composer seat.
		* @param ctx - client root context.
		* @param config - the seat selection.
		*/
		function apply(ctx, config = {}) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-cost-meter: dictionaries");
			const seat = resolveSeat(config);
			const register = seat === "meter" ? () => ctx.slots.register({
				name: "conversation.input.meter",
				locale: NS
			}, CostMeter) : () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "cost",
				order: 20,
				locale: NS
			}, CostMeter);
			ctx.slots.inject(seat === "meter" ? "conversation.input.meter" : "conversation.input.dock", register);
		}
		//#endregion
		exports.CostMeter = CostMeter;
		exports.apply = apply;
		exports.currencySymbol = currencySymbol;
		exports.formatClockMs = formatClockMs;
		exports.formatCost = formatCost;
		exports.formatModelName = formatModelName;
		exports.formatModelShortName = formatModelShortName;
		exports.formatPrice = formatPrice;
		exports.formatTokens = formatTokens;
		exports.inject = inject;
		exports.parseEffectiveFrom = parseEffectiveFrom;
		exports.parseOffsetMinutes = parseOffsetMinutes;
		exports.resolveSeat = resolveSeat;
		exports.resolveTier = resolveTier;
		exports.wallClockMinuteOfDay = wallClockMinuteOfDay;
		return module.exports;
	}
});
