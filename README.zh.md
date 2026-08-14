# dsh-cost-meter

[English](README.md) | 中文

DeepSeek Harness 社区插件：把日志中的模型用量按配置的定价表折成每个会话的
货币费用，并通过会话投影机制以 `usageCost` 投影单元对外提供。Web 界面的
输入栏读取同一个键，展示会话费用徽标和当前价格面板。

## 安装

```bash
dsh plugin --profile <name> add github:HenryShown/DSH-CostMeter
```

该命令把插件安装到对应 profile 并自动挂载组合行（本包通过
`dsh.bundle.patch` 声明贡献 `cordis.patch.yml`）。`session-projection`
注册表随 `dsh-base` bundle 提供；若你的组合没有它，需显式添加
`@deepseek-ai/dsh-session-projection`。

## 配置

每个字段都默认使用随附的 DeepSeek V4 定价表，因此不带任何配置挂载插件也能
正确计算 V4 Flash 和 V4 Pro 的费用。价格单位是每 100 万 token 的货币金额；
未知配置键会在加载时直接报错。注意：一旦提供了 `models`，整张表会被整体
替换——只写部分模型会让其它随附模型的定价条目失效。

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

## 计价规则

每个用量样本按它自己的事件时间计价。在 `effectiveFrom` 之前（按配置时区
比较）使用固定的 `before` 档；从该时刻起，落在每个 `peakPeriods` 区间内
使用 `peak` 档，其余时间为 `offPeak` 档。区间是本地时间、左闭右开
（`HH:MM-HH:MM`，允许以 `24:00` 结尾）。

三个计费桶互不重叠：缓存命中输入是 `cacheReadTokens`，缓存未命中输入是
`inputTokens + cacheWriteTokens`，输出是 `outputTokens`。费用是三者各自
乘以单价后相加，再除以 1,000,000。

折叠逻辑沿用 dsh-token-meter 的用量样本替换约定：同一 `(turn, step)` 上，
汇总后的 `assistant/message` 用量会替换流式 `assistant/chunk` 用量，绝不
重复计算。替换时先把被取代的样本从它自己所属的模型行扣回，再落到新样本的
模型行上，因此步骤中途切换模型时，该步用量会整体移到新模型而不是重复计费。
每个样本按最新一条 `request/header` 记录的模型计价；没有前置
header、或模型不在价格表中的样本不计入。

## 投影

`usageCost` 单元的值包含 `currency`、`totalCost`、每个已计价模型一行
（含各桶 token 数和 `cost`），以及面向客户端的 `schedule` 快照，其中
`peakRanges` 和 `effectiveFromMs` 已经解析好。客户端导入键合并后即可通过
`useProjection` 读取：

```ts
import type {} from 'dsh-cost-meter/client'
```

## 组合方式

插件依赖 `ctx.sessionProjections`，并在插件 fiber 存续期间注册单元，
卸载即移除该键。本包自带的 patch 层挂载一行 `cost-meter`；手工组合的
最小配置如下：

```yaml
- name: '@deepseek-ai/dsh-session-projection'
- name: 'dsh-cost-meter'
```

## 开发

peer 依赖（`@deepseek-ai/*`）由 DeepSeek Harness 安装环境提供（npm
registry 上并不完整），因此完整测试套件请在 DSH checkout 内运行（把本
仓库放进 checkout 的 workspace 后执行 `vitest run`），或本地链接这些
peer 包：

```bash
pnpm install
pnpm test -- tests/pricing.spec.ts   # 纯计价套件可独立运行
```

源码位于 `src/`；构建产物 `lib/` 已随仓库提交，可直接安装使用。

## 已知限制与后续工作

- **未定价模型不产生费用** — 在第一条 `request/header` 之前记录的用量，
  或模型 id 不在 `models` 中的用量，不会用其它档位去猜测，而是不计入总数。
- **费用是浮点数，不是账单记录** — 显示时四舍五入到小数点后四位；供应商
  账单才是权威账目。
- **界面上的“当前价格”档位跟随客户端时钟** — 计费总数始终由主机端折叠
  得出，但面板中针对显示“现在”的档位标签在浏览器里计算，打开期间每 30 秒
  刷新一次。
- **定价表是部署配置，不是用户设置** — 修改价格或时段需要编辑 cordis.yml
  中的插件行，而不是设置界面。
