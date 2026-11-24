export const TOPICS = {
  state: "battery.state",
  config: "battery.config",
} as const;

export const METHODS = {
  getState: "battery.getState",
  getConfig: "battery.getConfig",
  refresh: "battery.refresh",
} as const;

export type BatteryState = {
  // false 表示这次没读到电池（台式机、WMI 失败），此时 percent 保留上一次读数。
  ok: boolean;
  percent: number;
  charging: boolean;
  full: boolean;
  ac: boolean;
  // 充电时是「充满还需」，放电时是「还能用」；未知为 null。
  minutes: number | null;
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
  name: "",
  error: null,
  updatedAt: 0,
};

export type FillStyle = "simple" | "wave" | "sparkle";
export type ChargeColor = "green" | "blue" | "accent" | "custom";

export type BatteryConfig = {
  style: FillStyle;
  chargeColor: ChargeColor;
  customColor: string;
  showRing: boolean;
  animate: boolean;
};

export const DEFAULT_CONFIG: BatteryConfig = {
  style: "wave",
  chargeColor: "blue",
  customColor: "#3da9ff",
  showRing: false,
  animate: true,
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
  return {
    style: style === "simple" || style === "sparkle" ? style : "wave",
    chargeColor: chargeColor === "green" || chargeColor === "accent" || chargeColor === "custom" ? chargeColor : "blue",
    customColor: typeof input.customColor === "string" ? input.customColor : DEFAULT_CONFIG.customColor,
    showRing: input.showRing === true,
    animate: input.animate !== false,
  };
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
