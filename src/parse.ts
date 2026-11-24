import type { BatteryState } from "./types.ts";

export type BatteryReading = Pick<
  BatteryState,
  "ok" | "percent" | "charging" | "full" | "ac" | "minutes" | "name"
>;

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

  return {
    kind: "ok",
    reading: {
      ok: true,
      percent: Math.round(clamp(num(o.percent), 0, 100)),
      charging: o.charging === true,
      full: o.full === true,
      ac: o.ac === true,
      minutes,
      name: typeof o.name === "string" ? o.name : "",
    },
  };
}
