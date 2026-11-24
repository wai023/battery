# 电量 · Battery

浮屿（Fuyu）插件。在岛上显示电池电量与充电状态，胶囊随电量填充，支持液体波浪和光点粒子两种动画。

![三种填充样式](docs/preview.png)

## 功能

- **三种填充样式**：简单填充、液体波浪、光点和粒子
- **胶囊填充**：液面高度跟随电量，插着电源时用设定颜色（满电也是该颜色），纯电池时按电量变绿 / 黄 / 红
- **电量圆环**：沿胶囊边缘画进度，颜色与填充一致
- **收起条**：图标 + 迷你进度条 + 百分比
- **页面**：大号胶囊、状态、预计充满 / 剩余可用、电池名称

## 数据来源

宿主（Node 侧）每 30 秒执行一次 `assets/battery.ps1`，通过 `Win32_Battery` 读取：

| 字段 | 含义 |
|---|---|
| `EstimatedChargeRemaining` | 电量百分比 |
| `BatteryStatus` | 1 放电，2 接电源，3 已充满，6–9 充电中 |
| `TimeToFullCharge` | 充满还需分钟数（充电时） |
| `EstimatedRunTime` | 剩余可用分钟数（放电时） |

读不到时保留上次读数并标记状态，不会把数字归零。

## 配置

| 项 | 说明 |
|---|---|
| 填充动画 | `simple` / `wave` / `sparkle` |
| 充电时的颜色 | `green` / `blue` / `accent` / `custom` |
| 自定义颜色 | `#rrggbb`，仅 `custom` 时生效 |
| 显示电量圆环 | 关闭时胶囊只留 1px 内边距 |
| 开启动画 | 关闭后波浪与粒子静止，适合常驻省电 |

放电阈值固定为：高于 40% 绿色，21–40% 黄色，20% 及以下红色。

配置由宿主读取 `plugins-v3/data/@wai023/battery/config.json`（或浮屿注入的 config 访问器），再通过 `battery.config` 消息推给岛上页面与组件，面板保存后 1.5 秒内生效，不用重开页面。

## 安装

双击 `build/wai023-battery-0.1.1.fuyu` 即可；或在浮屿设置里打开「允许运行第三方插件」后再双击。

## 已知限制

- 多电池设备只取第一块。
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
