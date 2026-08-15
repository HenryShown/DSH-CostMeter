import z from "@deepseek-ai/schemastery";
import { z as z$1 } from "zod";
//#region src/pricing.ts
/** Currency denominator: every configured rate is per one million tokens. */
const PRICE_PER_MILLION = 1e6;
const PERIOD_PATTERN = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/;
const MINUTES_PER_DAY = 1440;
/**
* Validate and precompute one schedule. Failures throw at plugin load so a
* misconfigured table never silently prices requests wrong.
* @param config - the schema-validated schedule.
* @returns the resolved schedule.
*/
function resolveSchedule(config) {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format();
	} catch {
		throw new Error(`cost-meter: unknown timezone "${config.timezone}"`);
	}
	const effectiveFromMs = Date.parse(config.effectiveFrom);
	if (!Number.isFinite(effectiveFromMs)) throw new Error(`cost-meter: effectiveFrom "${config.effectiveFrom}" is not a valid instant`);
	return {
		currency: config.currency,
		priceUnit: config.priceUnit,
		timezone: config.timezone,
		effectiveFromMs,
		peakRanges: config.peakPeriods.map(parsePeriod),
		models: config.models
	};
}
/**
* Which tier applies to one instant: the flat pre-cutover tier, or the
* post-cutover peak/off-peak tier selected by the schedule's local wall time.
* @param schedule - resolved schedule.
* @param timeMs - epoch milliseconds of the billed instant.
* @returns the tier.
*/
function periodAt(schedule, timeMs) {
	if (timeMs < schedule.effectiveFromMs) return "before";
	const minuteOfDay = wallMinuteOfDay(schedule.timezone, timeMs);
	return schedule.peakRanges.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end) ? "peak" : "offPeak";
}
/**
* Resolve one model's unit price at one instant.
* @param schedule - resolved schedule.
* @param modelId - the model id recorded by the request header.
* @param timeMs - epoch milliseconds of the billed instant.
* @returns the tier and price, or undefined for an unpriced model.
*/
function resolveUnitPrice(schedule, modelId, timeMs) {
	const model = schedule.models[modelId];
	if (model === void 0) return void 0;
	const period = periodAt(schedule, timeMs);
	return {
		period,
		price: model[period]
	};
}
/**
* Currency cost of three disjoint token buckets under one unit price.
* @param buckets - cache-hit input, cache-miss input, and output tokens.
* @param price - unit price per one million tokens.
* @returns the cost in the schedule's currency.
*/
function costOfUsage(buckets, price) {
	return (buckets.inputCacheHitTokens * price.inputCacheHit + buckets.inputCacheMissTokens * price.inputCacheMiss + buckets.outputTokens * price.output) / PRICE_PER_MILLION;
}
/** Parse one `HH:MM-HH:MM` interval into an end-exclusive minute-of-day range; 24:00 is a valid end. */
function parsePeriod(period) {
	const match = PERIOD_PATTERN.exec(period);
	if (match === null) throw new Error(`cost-meter: peak period "${period}" is not HH:MM-HH:MM`);
	const startHour = Number(match[1]);
	const startMinute = Number(match[2]);
	const endHour = Number(match[3]);
	const endMinute = Number(match[4]);
	if (startHour >= 24 || endHour > 24 || startMinute >= 60 || endMinute >= 60 || endHour === 24 && endMinute !== 0) throw new Error(`cost-meter: peak period "${period}" has an out-of-range hour or minute`);
	const start = startHour * 60 + startMinute;
	const end = endHour * 60 + endMinute;
	if (start >= end || end > MINUTES_PER_DAY) throw new Error(`cost-meter: peak period "${period}" must span a non-empty within-day interval`);
	return [start, end];
}
/** Local wall-clock minute of day for one instant in the schedule's timezone. */
function wallMinuteOfDay(timeZone, timeMs) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		hour: "2-digit",
		minute: "2-digit"
	}).formatToParts(new Date(timeMs));
	let hour = 0;
	let minute = 0;
	for (const part of parts) if (part.type === "hour") hour = Number(part.value);
	else if (part.type === "minute") minute = Number(part.value);
	return hour * 60 + minute;
}
//#endregion
//#region src/projection.ts
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
const bucketsFrom = (usage) => ({
	inputCacheHitTokens: usage.cacheReadTokens ?? 0,
	inputCacheMissTokens: usage.inputTokens + (usage.cacheWriteTokens ?? 0),
	outputTokens: usage.outputTokens
});
const sameSample = (previous, model, buckets, cost) => previous.model === model && previous.cost === cost && previous.buckets.inputCacheHitTokens === buckets.inputCacheHitTokens && previous.buckets.inputCacheMissTokens === buckets.inputCacheMissTokens && previous.buckets.outputTokens === buckets.outputTokens;
/** Credit one sample's contribution back to its own model's row. */
function subtractSample(models, sample) {
	const index = models.findIndex((row) => row.model === sample.model);
	const existing = index === -1 ? void 0 : models[index];
	if (existing === void 0) return models;
	const credited = {
		model: sample.model,
		cost: existing.cost - sample.cost,
		inputCacheHitTokens: existing.inputCacheHitTokens - sample.buckets.inputCacheHitTokens,
		inputCacheMissTokens: existing.inputCacheMissTokens - sample.buckets.inputCacheMissTokens,
		outputTokens: existing.outputTokens - sample.buckets.outputTokens
	};
	const nextModels = [...models];
	nextModels[index] = credited;
	return nextModels;
}
/**
* Replace-or-append one sample's contribution: credit back the superseded
* sample to the row it was added to, then add the new sample on the priced
* model's row.
*/
function addSample(models, model, previous, buckets, cost) {
	const credited = previous === null ? models : subtractSample(models, previous);
	const index = credited.findIndex((row) => row.model === model);
	const existing = index === -1 ? void 0 : credited[index];
	const current = existing ?? {
		model,
		cost: 0,
		inputCacheHitTokens: 0,
		inputCacheMissTokens: 0,
		outputTokens: 0
	};
	const next = {
		model,
		cost: current.cost + cost,
		inputCacheHitTokens: current.inputCacheHitTokens + buckets.inputCacheHitTokens,
		inputCacheMissTokens: current.inputCacheMissTokens + buckets.inputCacheMissTokens,
		outputTokens: current.outputTokens + buckets.outputTokens
	};
	const nextModels = [...credited];
	if (existing === void 0) nextModels.push(next);
	else nextModels[index] = next;
	return nextModels;
}
const unitPriceSchema$1 = z$1.object({
	inputCacheHit: z$1.number().nonnegative(),
	inputCacheMiss: z$1.number().nonnegative(),
	output: z$1.number().nonnegative()
}).strict();
const modelPricingSchema$1 = z$1.object({
	before: unitPriceSchema$1,
	peak: unitPriceSchema$1,
	offPeak: unitPriceSchema$1
}).strict();
const scheduleSchema = z$1.object({
	currency: z$1.string().min(1),
	priceUnit: z$1.literal("per_1M_tokens"),
	timezone: z$1.string().min(1),
	effectiveFrom: z$1.string().min(1),
	effectiveFromMs: z$1.number(),
	peakRanges: z$1.array(z$1.tuple([z$1.number().int().nonnegative(), z$1.number().int().positive()])),
	models: z$1.record(z$1.string(), modelPricingSchema$1)
}).strict();
const projectionSchema = z$1.object({
	currency: z$1.string().min(1),
	totalCost: z$1.number().nonnegative(),
	models: z$1.array(z$1.object({
		model: z$1.string().min(1),
		cost: z$1.number().nonnegative(),
		inputCacheHitTokens: z$1.number().int().nonnegative(),
		inputCacheMissTokens: z$1.number().int().nonnegative(),
		outputTokens: z$1.number().int().nonnegative()
	}).strict()),
	schedule: scheduleSchema
}).strict();
/**
* Build the `usageCost` unit for one resolved schedule.
* @param schedule - the resolved pricing schedule.
* @param raw - the raw schedule snapshot served verbatim to clients.
* @returns the projection definition.
*/
function usageCostProjectionDefinition(schedule, raw) {
	return {
		key: "usageCost",
		schema: projectionSchema,
		init: () => ({
			models: [],
			last: null,
			currentModel: null
		}),
		apply: (state, event) => {
			if (event.type === "request/header") {
				const model = event.data.header.config.model;
				return state.currentModel === model ? state : {
					...state,
					currentModel: model
				};
			}
			let turn;
			let step;
			let usage;
			if (event.type === "assistant/chunk" && event.data.chunk.type === "usage") {
				({turn, step} = event.data);
				usage = event.data.chunk.usage;
			} else if (event.type === "assistant/message" && event.data.usage !== void 0) {
				({turn, step} = event.data);
				usage = event.data.usage;
			} else return state;
			if (state.currentModel === null) return state;
			const resolved = resolveUnitPrice(schedule, state.currentModel, event.time);
			if (resolved === void 0) return state;
			const buckets = bucketsFrom(usage);
			const cost = costOfUsage(buckets, resolved.price);
			const previous = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last : null;
			if (previous !== null && sameSample(previous, state.currentModel, buckets, cost)) return state;
			return {
				models: addSample(state.models, state.currentModel, previous, buckets, cost),
				last: {
					turn,
					step,
					model: state.currentModel,
					buckets,
					cost
				},
				currentModel: state.currentModel
			};
		},
		view: (state) => ({
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
				models: raw.models
			}
		}),
		stateVersion: 2
	};
}
//#endregion
//#region src/parse.ts
/** The page's shipped models, in the order the page lists them. */
const MODEL_IDS = ["deepseek-v4-flash", "deepseek-v4-pro"];
/** HTML entities the pricing page uses; decoded before pattern matching. */
const ENTITIES = {
	"&nbsp;": " ",
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": "\"",
	"&#x27;": "'"
};
/**
* Strip scripts, styles, and tags, decode the page's entities, and collapse
* whitespace into single spaces.
* @param html - the fetched page body.
* @returns the plain-text page.
*/
function toText(html) {
	return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity] ?? entity).replace(/\s+/g, " ");
}
/**
* The two numbers a flat-tier header row carries (flash first, pro second),
* matched only when they immediately follow the marker (`数量 元 数量 元`).
* The peak/off-peak table repeats the same headers without numbers, so the
* immediate-match rule keeps this anchored to the flat table.
*/
const FLAT_HEADER_PATTERNS = [
	/百万tokens输入（缓存命中）\s*([\d.]+)\s*元\s*([\d.]+)\s*元/,
	/百万tokens输入（缓存未命中）\s*([\d.]+)\s*元\s*([\d.]+)\s*元/,
	/百万tokens输出\s*([\d.]+)\s*元\s*([\d.]+)\s*元/
];
/**
* The flat pre-cutover tier, when the page still carries its table.
* @param text - the plain-text page.
* @returns flash and pro rows, or undefined when the table is absent.
*/
function parseFlatTier(text) {
	const rows = FLAT_HEADER_PATTERNS.map((pattern) => pattern.exec(text));
	if (rows.some((row) => row === null)) return void 0;
	const hitRow = rows[0];
	const missRow = rows[1];
	const outputRow = rows[2];
	const price = (index) => ({
		inputCacheHit: Number(hitRow[index + 1]),
		inputCacheMiss: Number(missRow[index + 1]),
		output: Number(outputRow[index + 1])
	});
	return {
		"deepseek-v4-flash": price(0),
		"deepseek-v4-pro": price(1)
	};
}
/**
* One model's peak/off-peak rows: six numbers immediately after the model
* marker (off-peak triple, then peak triple).
* @param text - the plain-text page.
* @param model - the model id marker to anchor on.
* @returns the two triples, or undefined when the row does not resolve.
*/
function parseModelTiers(text, model) {
	const match = new RegExp(`${model}\\s*空闲时段\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元\\s*高峰时段\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元`).exec(text);
	if (match === null) return void 0;
	return {
		offPeak: {
			inputCacheHit: Number(match[1]),
			inputCacheMiss: Number(match[2]),
			output: Number(match[3])
		},
		peak: {
			inputCacheHit: Number(match[4]),
			inputCacheMiss: Number(match[5]),
			output: Number(match[6])
		}
	};
}
/**
* The `HH:MM - HH:MM` peak intervals in the page's cutover notice.
* @param text - the plain-text page.
* @returns the minute ranges, in page order.
*/
function parsePeakRanges(text) {
	const ranges = [];
	for (const match of text.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) ranges.push([Number(match[1]) * 60 + Number(match[2]), Number(match[3]) * 60 + Number(match[4])]);
	return ranges;
}
/**
* The Chinese cutover sentence, normalized to the ISO form with the page's
* Beijing offset.
* @param text - the plain-text page.
* @returns the ISO cutover, or undefined when the sentence is absent.
*/
function parseEffectiveFrom(text) {
	const match = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/.exec(text);
	if (match === null) return void 0;
	const pad = (value) => value.padStart(2, "0");
	return `${match[1]}-${pad(match[2])}-${pad(match[3])}T${pad(match[4])}:${pad(match[5])}:00+08:00`;
}
/**
* Parse the page. Peak and off-peak buckets for every shipped model plus
* the peak intervals are required; the flat tier and the cutover sentence
* are best-effort (the page drops them over time).
* @param html - the fetched page body.
* @returns the snapshot, or null when the required parts do not resolve.
*/
function parseOfficialPricing(html) {
	const text = toText(html);
	const peak = {};
	const offPeak = {};
	for (const model of MODEL_IDS) {
		const tiers = parseModelTiers(text, model);
		if (tiers === void 0) return null;
		offPeak[model] = tiers.offPeak;
		peak[model] = tiers.peak;
	}
	const peakRanges = parsePeakRanges(text);
	if (peakRanges.length === 0) return null;
	const effectiveFrom = parseEffectiveFrom(text);
	if (effectiveFrom === void 0) return null;
	const before = parseFlatTier(text);
	return {
		...before !== void 0 ? { before } : {},
		peak,
		offPeak,
		peakRanges,
		timezone: "Asia/Shanghai",
		effectiveFrom,
		effectiveFromMs: Date.parse(effectiveFrom)
	};
}
//#endregion
//#region src/prices.ts
/** Local route the node half serves and the browser half reads. */
const PRICES_ENDPOINT = "/plugins/dsh-cost-meter/prices.json";
//#endregion
//#region src/index.ts
/** Cordis plugin name. */
const name = "cost-meter";
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
const inject = ["sessionProjections"];
/** The official pricing page, in the same locale the parser targets. */
const DEFAULT_PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
const unitPriceSchema = z.object({
	inputCacheHit: z.number().min(0),
	inputCacheMiss: z.number().min(0),
	output: z.number().min(0)
});
const modelPricingSchema = z.object({
	before: unitPriceSchema,
	peak: unitPriceSchema,
	offPeak: unitPriceSchema
});
const periodStringSchema = z.string().pattern(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
/**
* The shipped DeepSeek V4 schedule: flat rates before 2026-08-17 00:00
* (Asia/Shanghai), then peak rates 09:00-12:00 and 14:00-18:00 with
* off-peak rates half the peak rates outside those intervals. Rates are CNY
* per one million tokens; every value is overridable from cordis.yml.
*/
const DEFAULT_PRICING = {
	currency: "CNY",
	priceUnit: "per_1M_tokens",
	timezone: "Asia/Shanghai",
	effectiveFrom: "2026-08-17T00:00:00+08:00",
	peakPeriods: ["09:00-12:00", "14:00-18:00"],
	models: {
		"deepseek-v4-flash": {
			before: {
				inputCacheHit: .02,
				inputCacheMiss: 1,
				output: 2
			},
			peak: {
				inputCacheHit: .1,
				inputCacheMiss: 3,
				output: 9
			},
			offPeak: {
				inputCacheHit: .05,
				inputCacheMiss: 1.5,
				output: 4.5
			}
		},
		"deepseek-v4-pro": {
			before: {
				inputCacheHit: .025,
				inputCacheMiss: 3,
				output: 6
			},
			peak: {
				inputCacheHit: .3,
				inputCacheMiss: 9,
				output: 27
			},
			offPeak: {
				inputCacheHit: .15,
				inputCacheMiss: 4.5,
				output: 13.5
			}
		}
	}
};
/** Runtime schema for {@link CostMeterConfig}; unknown keys are rejected by {@link validateConfig}. */
const Config = z.object({
	currency: z.string().min(1).default(DEFAULT_PRICING.currency),
	priceUnit: z.const("per_1M_tokens").default(DEFAULT_PRICING.priceUnit),
	timezone: z.string().min(1).default(DEFAULT_PRICING.timezone),
	effectiveFrom: z.string().min(1).default(DEFAULT_PRICING.effectiveFrom),
	peakPeriods: z.array(periodStringSchema).default([...DEFAULT_PRICING.peakPeriods]),
	models: z.dict(modelPricingSchema).default({ ...DEFAULT_PRICING.models }),
	pricingUrl: z.string().min(1).default(DEFAULT_PRICING_URL),
	refreshIntervalMs: z.number().step(1).min(1).default(36e5),
	requestTimeoutMs: z.number().step(1).min(1).default(1e4)
});
const CONFIG_KEYS = new Set([
	"currency",
	"priceUnit",
	"timezone",
	"effectiveFrom",
	"peakPeriods",
	"models",
	"pricingUrl",
	"refreshIntervalMs",
	"requestTimeoutMs"
]);
/** Reject stale or misspelled keys before defaults can hide them. */
function validateConfig(config) {
	for (const key of Object.keys(config)) if (!CONFIG_KEYS.has(key)) throw new Error(`cost-meter: unknown key "${key}"`);
}
/**
* Mount the official-price feed: one refresh at activation plus an unref'd
* interval, and the JSON route the browser half reads.
* @param ctx - host context carrying the web route registry.
* @param webServer - the surface's web route registry.
* @param pricingUrl - the official pricing page URL.
* @param refreshIntervalMs - refresh interval in milliseconds.
* @param requestTimeoutMs - per-request timeout in milliseconds.
*/
function mountPricingFeed(ctx, webServer, pricingUrl, refreshIntervalMs, requestTimeoutMs) {
	let snapshot = null;
	let fetchedAt = 0;
	const refresh = async () => {
		try {
			const response = await fetch(pricingUrl, { signal: AbortSignal.timeout(requestTimeoutMs) });
			if (!response.ok) return;
			const parsed = parseOfficialPricing(await response.text());
			if (parsed !== null) {
				snapshot = parsed;
				fetchedAt = Date.now();
			}
		} catch {}
	};
	ctx.effect(() => {
		refresh();
		const timer = setInterval(() => {
			refresh();
		}, refreshIntervalMs);
		timer.unref();
		return () => {
			clearInterval(timer);
		};
	}, "cost-meter: official pricing refresh");
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: PRICES_ENDPOINT,
		handler: (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405);
				res.end();
				return;
			}
			const body = snapshot === null ? { ok: false } : {
				ok: true,
				fetchedAt,
				prices: snapshot
			};
			res.writeHead(snapshot === null ? 404 : 200, {
				"content-type": "application/json",
				"cache-control": "no-cache"
			});
			res.end(JSON.stringify(body));
		}
	}), "cost-meter: official pricing route");
}
/**
* Register the `usageCost` unit; the registration is an effect on this
* plugin's fiber, so unloading removes the key. Surfaces with a web server
* additionally mount the official-price feed.
* @param ctx - registrant context carrying the projection registry.
* @param config - the pricing schedule; defaults to the shipped DeepSeek V4 table.
*/
function apply(ctx, config = DEFAULT_PRICING) {
	validateConfig(config);
	const schedule = resolveSchedule(config);
	ctx.sessionProjections.register(usageCostProjectionDefinition(schedule, config));
	let feedMounted = false;
	const mountFeed = () => {
		if (feedMounted) return;
		const webServer = ctx.get("webServer", false);
		if (webServer === void 0) return;
		feedMounted = true;
		mountPricingFeed(ctx, webServer, config.pricingUrl ?? DEFAULT_PRICING_URL, config.refreshIntervalMs ?? 36e5, config.requestTimeoutMs ?? 1e4);
	};
	mountFeed();
	ctx.on("internal/service", (name) => {
		if (name === "webServer") mountFeed();
	});
}
//#endregion
export { Config, DEFAULT_PRICING, PRICES_ENDPOINT, PRICE_PER_MILLION, apply, costOfUsage, inject, name, parseOfficialPricing, resolveUnitPrice };
