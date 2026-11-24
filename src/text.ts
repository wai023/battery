const en = {
  title: "Battery",
  charging: "Charging",
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
};

const zhCN: typeof en = {
  title: "电量",
  charging: "充电中",
  discharging: "使用中",
  full: "已充满",
  noBattery: "未检测到电池",
  readFailed: "读取失败",
  wmiFailed: "电池查询失败",
  refresh: "刷新",
  settings: "设置",
  hint: "电量每 30 秒从 Windows 读取一次。高于 40% 显示绿色，21–40% 黄色，20% 及以下红色。",
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
};

export const text = navigator.language.toLowerCase().startsWith("zh") ? zhCN : en;
