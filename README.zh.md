# dsh-cost-meter

[English](README.md) | 中文

DeepSeek Harness 插件：把已记录的 provider 用量折叠成每个会话的货币费用，并在 Web composer 里显示——发送按钮旁的**费用药丸**点击打开面板，展示会话合计、分模型费用与 token 明细、当前生效档位的每百万 token **实时费率表**以及峰谷计价切换提醒。宿主半边还每小时刷新 **DeepSeek 官方定价页**，面板优先使用该快照而非本地配置。

一个包、两个半边：

- **宿主半边** —— 注册 `usageCost` 会话投影单元，并在 `/plugins/dsh-cost-meter/prices.json` 服务官方价格快照（没有 Web 服务器的界面只保留投影）。
- **浏览器半边**（`./client`）—— 渲染 composer 药丸与面板；座位可配置（默认 `dock`，新版 harness 可用 `meter`）。

## 安装

```bash
dsh plugin --profile <name> add github:HenryShown/DSH-CostMeter
```

该命令把包安装进 profile 并自动挂载组合行（包声明了 `dsh.bundle.patch`，其 `cordis.patch.yml` 以 insert 形式插入该行）。会话投影注册表随 `dsh-base` 提供；不含它的组合需显式添加 `@deepseek-ai/dsh-session-projection`。

安装后重启 Web 服务（新的 bundle 层在下一次启动时生效），打开会话即可在发送按钮旁看到费用药丸。验证：

```bash
# 组合包含该行（且无 "entry not found" 警告）：
dsh --profile <name> --dump-config
# 宿主半边服务官方快照（需要外网 HTTPS）：
curl -s http://127.0.0.1:3090/plugins/dsh-cost-meter/prices.json
```

## 面板展示内容

- **药丸**：会话合计（`¥2.9909`），经 `usageCost` 投影实时更新；悬停显示 `费用 ¥2.9909`。
- **面板**：突出显示的会话合计；分模型费用与 token 明细（`输入 · 缓存命中 72.1M`）；`实时费率/1M tokens` 费率表（`模型 / 缓存命中 / 未命中 / 输出` 列，显示当前生效档位）；切换提醒（`◷ 8 月 17 日起启用峰谷计价`），生效前标注 `即将生效`。
- **实时档位**：展示档位按客户端时钟对照切换时间与峰谷区间解析，面板打开期间每 30 秒重算。
- **官方同步**：宿主半边有快照时，费率表与切换时间取自官方定价页并标注 `官方同步 HH:MM`；抓取/解析失败时静默回退本地配置。

## 配置

宿主侧所有字段默认内置 DeepSeek V4 价格表，零配置即可正确计价 V4 Flash 与 V4 Pro。费率单位为每百万 token；未知键在加载时报错。提供 `models` 会整体替换内置表：部分 `models` 映射会丢弃其余模型的内置条目。`pricingUrl`、`refreshIntervalMs`、`requestTimeoutMs` 控制官方价格抓取。

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

浏览器半边通过自身的 `config.seat` 选择 composer 座位：

```yaml
- id: cost-meter
  name: 'dsh-cost-meter'
  config:
    seat: dock   # 默认；也可填 meter
```

- `dock` —— composer 上方的列表条（`conversation.input.dock`）。所有 Web 界面都有；这是可移植的默认值。
- `meter` —— 上下文占用环右侧的命名座位（`conversation.input.meter`），仅较新的 ui-conversation 构建声明。旧构建上该贡献不会渲染。

## 计价规则

每个用量样本按其自身事件时间计价。在 `effectiveFrom`（按配置时区比较）之前适用统一的 `before` 档；从该时刻起，`peakPeriods` 各区间内适用 `peak` 档，其余时间适用 `offPeak` 档。区间为闭开本地墙钟时间（`HH:MM-HH:MM`，结束允许 `24:00`）。

三个计费桶互不相交：缓存命中输入为 `cacheReadTokens`，缓存未命中输入为 `inputTokens + cacheWriteTokens`，输出为 `outputTokens`。费用为三个乘积之和除以 1,000,000。

折叠沿用 dsh-token-meter 的用量样本替换不变量：组装后的 `assistant/message` 用量替换同一 `(turn, step)` 的流式 `assistant/chunk` 用量，样本永不计两次。替换时把被取代样本记回其自身模型行，因此步骤中途切换模型会把该步骤用量转移到新模型而不是重复计数。每个样本按最新 `request/header` 记录的模型计价；没有前置 header 或模型不在价目表中的样本不贡献任何费用。

## 官方实时费率

DeepSeek 没有结构化价格接口，宿主半边抓取官方定价文档页（Docusaurus HTML）并严格解析：两个内置模型的全部峰/谷桶都必须解析成功，否则整体放弃——显示错误价格比回退本地配置更糟。抓取或解析失败保留上一次成功快照；没有快照时路由以 HTTP 404 应答 `{ "ok": false }`。抓取每小时一次，空闲时定时器已 unref，不做任何请求。

## 开发

peer 包（`@deepseek-ai/*`）由 DeepSeek Harness 安装提供，不在 npm registry 上。把本仓库放到 checkout 的 workspace 下（`packages/community/dsh-cost-meter`）让 workspace 链接解析 peer，然后：

```bash
pnpm install
pnpm exec vitest run packages/community/dsh-cost-meter   # 在 checkout 根目录执行
pnpm --filter dsh-cost-meter exec tsc -p tsconfig.build.json
pnpm --filter dsh-cost-meter exec tsdown
```

提交的 `lib/` 即为安装物——使用者无需构建。bundle 自包含：浏览器半边自行注入样式表（不依赖 CSS 管线），仅把 harness 平台模块外置。

## Known Limitations and Deferred Work

- **未计价模型不贡献费用** —— 首个 `request/header` 之前记录的用量，或模型 id 不在 `models` 中的用量，对合计不可见，不会从其他档位猜测。
- **费用是 float64，不是账单记录** —— 展示时四舍五入到四位小数；供应商账单才是权威计费依据。
- **展示档位跟随客户端时钟** —— 计费合计始终是宿主按事件时间折叠的结果，但面板的档位标签与费率表按浏览器时钟与时区数据解析；客户端时钟偏差会显示错误档位，而合计不受影响。
- **官方快照解析的是 HTML** —— 页面改版会让严格解析器失败关闭，面板随即显示本地配置表，直到解析器跟上。
- **价格表是部署配置而非用户设置** —— 修改费率或时段意味着编辑 cordis.yml 里的插件行，而不是设置界面。
