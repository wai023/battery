# 电量 · Battery

浮屿（Fuyu）插件。在岛上显示电池电量与充电状态，胶囊随电量填充，支持液体波浪和光点粒子两种动画。

![三种填充样式](docs/preview.png)

## 功能

- **三种填充样式**：简单填充、液体波浪、光点和粒子
- **胶囊填充**：液面高度跟随电量，插着电源时用设定颜色（满电也是该颜色），纯电池时按电量变绿 / 黄 / 红
- **电量圆环**：沿胶囊边缘画进度，颜色与填充一致
- **收起条**：图标 + 迷你进度条 + 百分比
- **页面**：大号胶囊、状态、预计充满 / 剩余可用、充电功率、电池名称
- **提醒**：电量跌到阈值提醒一次，充满提醒拔电，都在岛上弹出，阈值与开关可配

## 数据来源

宿主（Node 侧）常驻一个 `assets/battery.ps1` 子进程，两种请求：

- `PING` 每 30 秒一次，走 WMI 读完整数据（电量、功率、剩余时间），单次约 26 毫秒
- `POLL` 每 800 毫秒一次，只读 kernel32 的电源状态，单次约 0.04 毫秒

分开的原因：`Win32_Battery` 走 WMI，插拔电源后要一两秒才更新，而任务栏电源图标用的内核接口是毫秒级。拔插电由 `POLL` 捕捉，插上或拔掉后 800 毫秒内颜色与状态就会变；容量、功率这些慢变量仍由 `PING` 负责。

`POLL` 只更新「是否接电源 / 是否充电 / 是否充满」，电量百分比以 `PING` 的完整读为准——内核与 WMI 偶尔差一个百分点，两路混用会让数字来回跳。

主读数来自 `Win32_Battery`：

| 字段 | 含义 |
|---|---|
| `EstimatedChargeRemaining` | 电量百分比 |
| `BatteryStatus` | 1 放电，2 接电源，3 已充满，6–9 充电中 |
| `TimeToFullCharge` | 充满还需分钟数（充电时，驱动常为空） |
| `EstimatedRunTime` | 剩余可用分钟数（放电时，未知时是 `71582788` 这类哨兵值，已丢弃） |

功率与更可靠的充满估算来自 `root\wmi` 的 `BatteryStatus` / `BatteryFullChargedCapacity`：

| 字段 | 含义 |
|---|---|
| `ChargeRate` / `DischargeRate` | 充放电功率（毫瓦），页面除以 1000 显示为瓦 |
| `RemainingCapacity` | 当前容量（毫瓦时） |
| `FullChargedCapacity` | 满电容量，用来算“还剩多少才充满”，缓存 10 分钟 |

驱动不填这些字段时页面显示 `—`，不会编一个假数字。读不到电池时保留上次读数并标记状态，不会把数字归零。

## 配置

| 项 | 说明 |
|---|---|
| 填充动画 | `simple` / `wave` / `sparkle` |
| 充电时的颜色 | `green` / `blue` / `accent` / `custom` |
| 自定义颜色 | `#rrggbb`，仅 `custom` 时生效 |
| 显示电量圆环 | 关闭时胶囊只留 1px 内边距 |
| 开启动画 | 关闭后波浪与粒子静止，适合常驻省电 |
| 低电量提醒 | 跌破阈值时在岛上提醒一次，插电或回血 5 个百分点后重置 |
| 低电量阈值 | `10` / `15` / `20` / `30`，默认 20 |
| 充满提醒 | 充到 100% 提醒拔电，减少长期满电搁置 |

放电阈值固定为：高于 40% 绿色，21–40% 黄色，20% 及以下红色。

配置变更走宿主侧的 `ctx.config.onChange`，保存后立刻推给岛上；另有 10 秒一次的文件轮询兜底（读 `plugins-v3/data/@wai023/battery/config.json`），旧版浮屿没有 `onChange` 时也不会失联。

## 安装

到 [Releases](https://github.com/wai023/battery/releases) 下载最新的 `wai023-battery-*.fuyu`，双击安装。浮屿若拦第三方插件，先在设置里打开「允许运行第三方插件」。

自己构建：`npm i && npm run package`，产物落在 `build/` 下。

## 已知限制

- 多电池设备只取第一块。
- 充放电功率来自 `root\wmi`，部分驱动不上报，此时页面不显示功率一列。
- 台式机无电池时显示「未检测到电池」。
- `island.widget/v1` 尚未进入市场检查器的白名单，因此暂未上架，只能本地分发。

## 开发

```bash
npm run typecheck
npm run lint
npm test
npm run package
```

`docs/preview.png` 与 `build/preview.html` 用同一套几何（`src/gauge.ts`）生成，改了配色或形状记得一起更新：

```bash
npm i -D @resvg/resvg-js
node --experimental-strip-types tools/preview-image.mjs
```
