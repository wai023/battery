import { HUD_CONTENT_TOP, HUD_PAD_TOP, HUD_SIZE, type BatteryState } from "./types.ts";

export type BatteryReading = Pick<
  BatteryState,
  "ok" | "percent" | "charging" | "full" | "ac" | "minutes" | "watts" | "minutesToFull" | "name"
>;

export type ScreenArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// SCREEN 的应答：鼠标所在显示器的可用区域（已扣掉任务栏）。
// 拿不到就返回 null，浮窗退回让宿主自己放，不会因为定位失败就不弹。
export function parseScreen(raw: string): ScreenArea | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;

  const o = data as Record<string, unknown>;
  if (o.ok !== true) return null;

  const x = num(o.x, Number.NaN);
  const y = num(o.y, Number.NaN);
  const width = num(o.width, 0);
  const height = num(o.height, 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return null;

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

// 浮窗窗口坐标：水平居中于鼠标所在屏，内容顶边落在岛下方 30px。
// 窗口比屏幕窄/高时夹在工作区内，避免多屏之间出现半截窗口。
export function hudPosition(area: ScreenArea): { x: number; y: number } {
  const x = area.x + Math.round(area.width / 2) - Math.round(HUD_SIZE.width / 2);
  const y = area.y + HUD_CONTENT_TOP - HUD_PAD_TOP;
  return {
    x: clamp(x, area.x, area.x + Math.max(0, area.width - HUD_SIZE.width)),
    y: clamp(y, area.y, area.y + Math.max(0, area.height - HUD_SIZE.height)),
  };
}

export type BatteryParse =
  | { kind: "ok"; reading: BatteryReading }
  | { kind: "none"; reason: string }
  | { kind: "bad" };

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 脚本可能带上 PowerShell 的杂音，只取第一个完整 JSON 对象。
export function parseBattery(raw: string): BatteryParse {
  if (!raw) return { kind: "bad" };
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { kind: "bad" };

  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { kind: "bad" };
  }
  if (!data || typeof data !== "object") return { kind: "bad" };

  const o = data as Record<string, unknown>;
  if (o.ok !== true) {
    return { kind: "none", reason: typeof o.reason === "string" ? o.reason : "no-battery" };
  }

  const minutes = typeof o.minutes === "number" && Number.isFinite(o.minutes) && o.minutes > 0
    ? Math.round(o.minutes)
    : null;

  // 功率和估算充满时间都是「有就有、没有就 null」，不做兜底数字，免得显示假的 0W。
  const watts = typeof o.watts === "number" && Number.isFinite(o.watts) && o.watts > 0
    ? Math.round(o.watts * 10) / 10
    : null;
  const minutesToFull =
    typeof o.minutesToFull === "number" && Number.isFinite(o.minutesToFull) && o.minutesToFull > 0
      ? Math.round(o.minutesToFull)
      : null;

  return {
    kind: "ok",
    reading: {
      ok: true,
      percent: Math.round(clamp(num(o.percent), 0, 100)),
      charging: o.charging === true,
      full: o.full === true,
      ac: o.ac === true,
      minutes,
      watts,
      minutesToFull,
      name: typeof o.name === "string" ? o.name : "",
    },
  };
}
