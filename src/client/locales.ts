/** `cost` namespace dictionaries (the composer meter's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'dock.label': '费用',
  'panel.title': '会话费用',
  'panel.total': '本会话费用',
  'panel.tokens.hit': '输入 · 缓存命中',
  'panel.tokens.miss': '输入 · 缓存未命中',
  'panel.tokens.output': '输出',
  'panel.pricing.title': '实时费率/1M tokens',
  'panel.pricing.official': '官方同步 {time}',
  'panel.pricing.model': '模型',
  'panel.pricing.hit': '缓存命中',
  'panel.pricing.miss': '未命中',
  'panel.pricing.output': '输出',
  'panel.effective': '◷ {month} 月 {day} 日起启用峰谷计价',
  'panel.effective.crossYear': '◷ {year} 年 {month} 月 {day} 日起启用峰谷计价',
  'panel.effective.tag.upcoming': '即将生效',
  'panel.effective.tag.active': '已生效',
} satisfies Record<string, string>

/** The cost namespace key union. */
export type CostKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'dock.label': 'Cost',
  'panel.title': 'Session cost',
  'panel.total': 'Session cost total',
  'panel.tokens.hit': 'Input · cache hit',
  'panel.tokens.miss': 'Input · cache miss',
  'panel.tokens.output': 'Output',
  'panel.pricing.title': 'Live rate/1M tokens',
  'panel.pricing.official': 'Official · {time}',
  'panel.pricing.model': 'Model',
  'panel.pricing.hit': 'Cache hit',
  'panel.pricing.miss': 'Miss',
  'panel.pricing.output': 'Output',
  'panel.effective': '◷ Peak/off-peak pricing starts {month}/{day}',
  'panel.effective.crossYear': '◷ Peak/off-peak pricing starts {month}/{day}/{year}',
  'panel.effective.tag.upcoming': 'Upcoming',
  'panel.effective.tag.active': 'Active',
} satisfies Record<CostKey, string>
