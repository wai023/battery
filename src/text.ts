const en = {
  title: "Battery",
  charging: "Charging",
  plugged: "Plugged in",
  discharging: "On battery",
  full: "Fully charged",
  noBattery: "No battery detected",
  readFailed: "Cannot read battery",
  wmiFailed: "Battery query failed",
  refresh: "Refresh",
  settings: "Settings",
  hint: "Level is read from Windows every 30 seconds. Thresholds: green above 40%, amber 21–40%, red at or below 20%.",
  span: (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  },
  toFull: (value: string) => `${value} until full`,
  remaining: (value: string) => `${value} left`,
  labelStatus: "Status",
  labelTimeCharge: "Time to full",
  labelTimeUse: "Time left",
  labelPower: "Power",
  labelBattery: "Battery",
  watt: (value: number) => `${value} W`,
  // 临时浮窗（独立窗口）的四组文案。
  hudPlug: "Power connected",
  hudPlugBody: (span: string) => `Charging · ${span} until full`,
  hudPlugIdle: "On AC, not charging right now",
  hudUnplug: "Power disconnected",
  hudUnplugBody: (span: string) => `${span} left`,
  hudUnplugIdle: "Running on battery",
  hudLow: "Battery low",
  hudLowBody: (span: string) => `About ${span} left · plug in soon`,
  hudLowIdle: "Plug in when you can",
  hudFull: "Fully charged",
  hudFullBody: "You can unplug now",
};

const zhCN: typeof en = {
  title: "电量",
  charging: "充电中",
  plugged: "已接电源",
  discharging: "使用中",
  full: "已充满",
  noBattery: "未检测到电池",
  readFailed: "读取失败",
  wmiFailed: "电池查询失败",
  refresh: "刷新",
  settings: "设置",
  hint: "电量每 30 秒从 Windows 读取一次。高于 40% 显示绿色，21–40% 黄色，20% 及以下红色。接电但电池没进电（保护阈值或已满）时显示「已接电源」。",
  span: (minutes: number) => {
    if (minutes < 60) return `${minutes} 分钟`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
  },
  toFull: (value: string) => `预计 ${value} 后充满`,
  remaining: (value: string) => `剩余可用 ${value}`,
  labelStatus: "状态",
  labelTimeCharge: "预计充满",
  labelTimeUse: "剩余可用",
  labelPower: "功率",
  labelBattery: "电池",
  watt: (value: number) => `${value} 瓦`,
  // 临时浮窗（独立窗口）的四组文案。
  hudPlug: "已接入电源",
  hudPlugBody: (span: string) => `充电中 · 预计 ${span} 后充满`,
  hudPlugIdle: "已接电源，暂未进电",
  hudUnplug: "已断开电源",
  hudUnplugBody: (span: string) => `剩余可用 ${span}`,
  hudUnplugIdle: "正在使用电池",
  hudLow: "电量偏低",
  hudLowBody: (span: string) => `剩余可用约 ${span} · 建议充电`,
  hudLowIdle: "建议尽快接上电源",
  hudFull: "已充满",
  hudFullBody: "可以拔下电源了",
};

export const text = navigator.language.toLowerCase().startsWith("zh") ? zhCN : en;
