/// <reference types="node" />
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "fuyu-plugin";
import { parseBattery } from "./parse.ts";
import {
  DEFAULT_CONFIG,
  INITIAL_STATE,
  METHODS,
  TOPICS,
  normalizeConfig,
  type BatteryConfig,
  type BatteryState,
} from "./types.ts";

export const name = "battery";
export const inject = {
  clients: null,
  commands: null,
};

// 电池变化慢，30 秒足够；窗口打开时若快照太旧会立刻补读一次。
const POLL_MS = 30_000;
const STALE_MS = 15_000;
const TIMEOUT_MS = 9_000;
// 配置面板保存后最多 1.5 秒推到岛上，比监听事件更皮实。
const CONFIG_POLL_MS = 1_500;
const CONFIG_FILE = "config.json";

export function apply(ctx: Context) {
  const scriptPath = join(ctx.dataDir, "battery.ps1");
  mkdirSync(ctx.dataDir, { recursive: true });
  const bundled = fileURLToPath(new URL("../assets/battery.ps1", import.meta.url));
  writeFileSync(scriptPath, readFileSync(bundled, "utf8"), "utf8");

  let state: BatteryState = { ...INITIAL_STATE, updatedAt: Date.now() };
  let inflight: Promise<BatteryState> | null = null;

  const publish = () => ctx.clients.publish(TOPICS.state, state);

  // 配置只由宿主读：先问 Fuyu 注入的 config 访问器（每次调用都读磁盘），
  // 拿不到再直接读 dataDir/config.json。窗口侧不碰配置服务，改用 topic 收。
  const configPath = join(ctx.dataDir, CONFIG_FILE);
  let config: BatteryConfig = { ...DEFAULT_CONFIG };

  function readConfig(): BatteryConfig {
    try {
      const accessor = (ctx as unknown as { config?: { get?: () => unknown } }).config;
      const values = accessor?.get?.();
      if (values !== undefined) return normalizeConfig(values);
    } catch {
      // 旧版浮屿没有 config 访问器，退回读文件。
    }
    try {
      return normalizeConfig(JSON.parse(readFileSync(configPath, "utf8")));
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function syncConfig(force = false): BatteryConfig {
    const next = readConfig();
    if (!force && JSON.stringify(next) === JSON.stringify(config)) return config;
    config = next;
    ctx.clients.publish(TOPICS.config, config);
    return config;
  }

  // 单次读取：读到关闭或超时就返回，绝不挂住宿主进程。
  // 定时器用 ctx.setTimeout，插件停掉时它会被一并清理。
  function runScript(): Promise<string> {
    return new Promise((resolve) => {
      let out = "";
      let settled = false;
      let cancelTimeout: (() => Promise<void>) | null = null;
      const proc = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
        { windowsHide: true },
      );
      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        if (cancelTimeout) void cancelTimeout();
        resolve(value);
      };
      cancelTimeout = ctx.setTimeout(() => {
        try { proc.kill(); } catch { /* 进程可能已退出 */ }
        finish("");
      }, TIMEOUT_MS);
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => { out += chunk; });
      proc.stderr.on("data", () => {});
      proc.on("error", () => finish(""));
      proc.on("close", () => finish(out));
    });
  }

  // 同一时刻只允许一次读取，避免开页面时多个组件同时触发。
  function poll(): Promise<BatteryState> {
    if (inflight) return inflight;
    inflight = (async () => {
      const parsed = parseBattery(await runScript());
      const now = Date.now();
      if (parsed.kind === "ok") {
        state = { ...state, ...parsed.reading, error: null, updatedAt: now };
      } else {
        // 读不到时保留上次电量，只把状态标成不可用，避免数字突然归零。
        state = {
          ...state,
          ok: false,
          charging: false,
          error: parsed.kind === "none" ? parsed.reason : "read-failed",
          updatedAt: now,
        };
      }
      publish();
      return state;
    })();
    return inflight.finally(() => { inflight = null; });
  }

  ctx.clients.handle(METHODS.getState, () => {
    if (Date.now() - state.updatedAt > STALE_MS) void poll();
    return state;
  });
  ctx.clients.handle(METHODS.getConfig, () => syncConfig());
  ctx.clients.handle(METHODS.refresh, () => poll());

  ctx.commands.register("refresh", () => poll(), {
    title: { "zh-CN": "刷新电量", en: "Refresh battery level" },
  });

  syncConfig(true);
  void poll();
  ctx.setInterval(() => { void poll(); }, POLL_MS);
  ctx.setInterval(() => { syncConfig(); }, CONFIG_POLL_MS);
}
