export const TOPICS = {
  state: "battery.state",
  config: "battery.config",
  hud: "battery.hud",
} as const;

export const METHODS = {
  getState: "battery.getState",
  getConfig: "battery.getConfig",
  getHud: "battery.getHud",
  refresh: "battery.refresh",
  // 浮窗播完动画后回报，宿主据此立刻隐藏窗口。
  hudDone: "battery.hudDone",
} as const;

// —— 临时浮窗 ——
// 窗口名同时是 package.json 里 fuyu.client 的键、插槽的 windowId。
export const HUD_WINDOW = "hud";
export const HUD_SIZE = { width: 380, height: 130 } as const;
// 内容距窗口顶留 30px：入场从 -16px 落下来、外加阴影，都要空间。
export const HUD_PAD_TOP = 30;
// 岛在屏幕顶部 14px、高 34px；浮窗内容顶边落在岛底边下方 30px。
export const ISLAND_BOTTOM = 48;
export const HUD_CONTENT_TOP = ISLAND_BOTTOM + 30;
// 窗口出现到隐藏的上限；窗口正常会提前回报 hudDone。
export const HUD_MAX_MS = 3_500;
// 同类事件 1 分钟内只弹一次，和原型里定的规则一致。
export const HUD_GAP_MS = 60_000;

export type HudKind = "plug" | "unplug" | "low" | "full";

export type HudPayload = {
  seq: number;
  kind: HudKind;
  percent: number;
  // 充电时是「充满还需」，放电时是「还能用」；未知为 null。
  minutes: number | null;
  charging: boolean;
};

export type BatteryState = {
  // false 表示这次没读到电池（台式机、WMI 失败），此时 percent 保留上一次读数。
  ok: boolean;
  percent: number;
  charging: boolean;
  full: boolean;
  ac: boolean;
  // 充电时是「充满还需」，放电时是「还能用」；未知为 null。
  minutes: number | null;
  // 充电/放电功率（瓦），来自 root\wmi；驱动不填就是 null。
  watts: number | null;
  // 按剩余容量与充电功率估的分钟数，比 Win32_Battery 的 TimeToFullCharge 靠谱。
  minutesToFull: number | null;
  name: string;
  error: string | null;
  updatedAt: number;
};

export const INITIAL_STATE: BatteryState = {
  ok: false,
  percent: 0,
  charging: false,
  full: false,
  ac: false,
  minutes: null,
  watts: null,
  minutesToFull: null,
  name: "",
  error: null,
  updatedAt: 0,
};

export type FillStyle = "simple" | "wave" | "sparkle";
export type ChargeColor = "green" | "blue" | "accent" | "custom";
// 用字符串存阈值，配置表单的 enum 只认字符串，读出来再转数字。
export type LowThreshold = "10" | "15" | "20" | "30";

export type BatteryConfig = {
  style: FillStyle;
  chargeColor: ChargeColor;
  customColor: string;
  showRing: boolean;
  animate: boolean;
  alertLow: boolean;
  lowAt: LowThreshold;
  alertFull: boolean;
  hud: boolean;
};

export const DEFAULT_CONFIG: BatteryConfig = {
  style: "wave",
  chargeColor: "blue",
  customColor: "#3da9ff",
  showRing: false,
  animate: true,
  alertLow: true,
  lowAt: "20",
  alertFull: true,
  hud: true,
};

// 放电时的颜色分段，和截图里的 40% / 20% 一致。
export const THRESHOLDS = { high: 40, low: 20 } as const;

export const TONES = {
  green: "#2fbf86",
  blue: "#3da9ff",
  amber: "#e0a13c",
  red: "#e05a5a",
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

// 只看「有没有插电」：满电后 charging 会变 false，但插着电源仍算接电状态。
export function isPlugged(state: BatteryState): boolean {
  return state.charging || state.ac || state.full;
}

// 把配置面板（或磁盘上的 config.json）读到的原始值收敛成完整配置。
// 缺项用默认值补齐，非法值退回默认，避免一处手滑整块样式失效。
export function normalizeConfig(raw: unknown): BatteryConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const style = input.style;
  const chargeColor = input.chargeColor;
  const lowAt = input.lowAt;
  return {
    style: style === "simple" || style === "sparkle" ? style : "wave",
    chargeColor: chargeColor === "green" || chargeColor === "accent" || chargeColor === "custom" ? chargeColor : "blue",
    customColor: typeof input.customColor === "string" ? input.customColor : DEFAULT_CONFIG.customColor,
    showRing: input.showRing === true,
    animate: input.animate !== false,
    alertLow: input.alertLow !== false,
    lowAt: lowAt === "10" || lowAt === "15" || lowAt === "30" ? lowAt : "20",
    alertFull: input.alertFull !== false,
    hud: input.hud !== false,
  };
}

// 提醒只在「跨过阈值」时触发一次，避免每 30 秒弹一条。
// 回血 5 个百分点或插上电源才算解除，防止在阈值上下来回抖。
export type AlertState = { low: boolean; full: boolean };
export type AlertFire = "low" | "full" | null;

export function evaluateAlerts(
  percent: number,
  plugged: boolean,
  full: boolean,
  config: BatteryConfig,
  prev: AlertState,
): { next: AlertState; fire: AlertFire } {
  const threshold = Number(config.lowAt) || 20;
  if (plugged) {
    const next = { low: false, full: prev.full };
    if (percent < 95) next.full = false;
    if (full && percent >= 100 && config.alertFull && !prev.full) {
      return { next: { low: false, full: true }, fire: "full" };
    }
    return { next, fire: null };
  }
  const next = { low: percent > threshold + 5 ? false : prev.low, full: false };
  if (percent <= threshold && config.alertLow && !prev.low) {
    return { next: { ...next, low: true }, fire: "low" };
  }
  return { next, fire: null };
}

// 插电时用固定色（绿/蓝/强调色/自定义），放电时按阈值红黄绿。
export function toneOf(percent: number, plugged: boolean, mode: ChargeColor, custom: string): string {
  if (plugged) {
    if (mode === "green") return TONES.green;
    if (mode === "accent") return "var(--fuyu-plugin-accent)";
    if (mode === "custom") return isHexColor(custom) ? custom : TONES.blue;
    return TONES.blue;
  }
  if (percent <= THRESHOLDS.low) return TONES.red;
  if (percent <= THRESHOLDS.high) return TONES.amber;
  return TONES.green;
}
