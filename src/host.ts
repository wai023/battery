/// <reference types="node" />
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "fuyu-plugin";
import { messagesV1 } from "fuyu-plugin/services";
import { parseBattery } from "./parse.ts";
import {
  DEFAULT_CONFIG,
  INITIAL_STATE,
  METHODS,
  TOPICS,
  evaluateAlerts,
  isPlugged,
  normalizeConfig,
  type AlertState,
  type BatteryConfig,
  type BatteryState,
} from "./types.ts";

export const name = "battery";
export const inject = {
  clients: null,
  commands: null,
  "messages/v1": null,
};

// 电池变化慢，30 秒足够；窗口打开时若快照太旧会立刻补读一次。
const POLL_MS = 30_000;
const STALE_MS = 15_000;
// 常驻进程冷启动约 0.5 秒，之后单次往返 15 毫秒上下，9 秒足够容忍卡顿。
const TIMEOUT_MS = 9_000;
// 配置走 ctx.config.onChange；文件轮询只当兜底，10 秒一次，不再 1.5 秒。
const CONFIG_POLL_MS = 10_000;
const CONFIG_FILE = "config.json";

type Notifier = {
  notify: (notice: {
    source: string;
    pluginId?: string;
    title: string;
    body: string;
    durationMs?: number;
  }) => unknown;
};

export function apply(ctx: Context) {
  const scriptPath = join(ctx.dataDir, "battery.ps1");
  mkdirSync(ctx.dataDir, { recursive: true });
  const bundled = fileURLToPath(new URL("../assets/battery.ps1", import.meta.url));
  writeFileSync(scriptPath, readFileSync(bundled, "utf8"), "utf8");

  let state: BatteryState = { ...INITIAL_STATE, updatedAt: Date.now() };
  let inflight: Promise<BatteryState> | null = null;
  let alerts: AlertState = { low: false, full: false };

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

  function pushConfig(next: BatteryConfig) {
    if (JSON.stringify(next) === JSON.stringify(config)) return;
    config = next;
    ctx.clients.publish(TOPICS.config, config);
  }

  function syncConfig(force = false) {
    const next = readConfig();
    if (force) {
      config = next;
      ctx.clients.publish(TOPICS.config, config);
      return config;
    }
    pushConfig(next);
    return config;
  }

  let messages: Notifier | null = null;
  try {
    messages = ctx.services.get(messagesV1) as unknown as Notifier;
  } catch {
    messages = null;
  }

  function notify(title: string, body: string) {
    try {
      messages?.notify({ source: "battery", pluginId: name, title, body, durationMs: 6000 });
    } catch {
      // 通知不可用不影响读数。
    }
  }

  // ---- 常驻 PowerShell 子进程：一次启动，之后每 30 秒发一行取一次数 ----
  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = "";
  let waiter: { resolve: (line: string) => void; timer: () => Promise<void> } | null = null;

  function settle(line: string) {
    const current = waiter;
    if (!current) return;
    waiter = null;
    void current.timer();
    current.resolve(line);
  }

  function drain() {
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      settle(line);
      nl = buffer.indexOf("\n");
    }
    // 没人等的时候别把输出堆在内存里。
    if (buffer.length > 64 * 1024) buffer = "";
  }

  function killChild() {
    const current = child;
    child = null;
    buffer = "";
    if (!current) return;
    try { current.stdin.write("QUIT\n", "utf8"); } catch { /* 已经退出 */ }
    try { current.kill(); } catch { /* 已经退出 */ }
  }

  function ensureChild(): boolean {
    if (child && child.exitCode === null && child.stdin.writable) return true;
    child = null;
    try {
      const proc = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Serve"],
        { windowsHide: true },
      );
      proc.stdout.setEncoding("utf8");
      proc.stderr.on("data", () => {});
      proc.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        drain();
      });
      proc.on("error", () => {
        if (child === proc) child = null;
        settle("");
      });
      proc.on("close", () => {
        if (child === proc) child = null;
        settle("");
      });
      child = proc;
      return true;
    } catch {
      child = null;
      return false;
    }
  }

  // 一次请求：写一行、等一行；超时就把进程杀掉，下次重新拉起。
  function request(): Promise<string> {
    return new Promise((resolve) => {
      if (!ensureChild() || !child) {
        resolve("");
        return;
      }
      const timer = ctx.setTimeout(() => {
        killChild();
        settle("");
      }, TIMEOUT_MS);
      waiter = { resolve, timer };
      try {
        child.stdin.write("PING\n", "utf8");
      } catch {
        killChild();
        settle("");
      }
    });
  }

  // 同一时刻只允许一次读取，避免开页面时多个组件同时触发。
  function poll(): Promise<BatteryState> {
    if (inflight) return inflight;
    inflight = (async () => {
      const parsed = parseBattery(await request());
      const now = Date.now();
      if (parsed.kind === "ok") {
        state = { ...state, ...parsed.reading, error: null, updatedAt: now };

        const result = evaluateAlerts(state.percent, isPlugged(state), state.full, config, alerts);
        alerts = result.next;
        if (result.fire === "low") {
          notify("电量偏低", `还剩 ${state.percent}%，接上电源吧`);
        } else if (result.fire === "full") {
          notify("电池已充满", "可以拔掉电源，长期满电插着会加速老化");
        }
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

  // 设置面板保存后立刻推给岛上；onChange 不可用时靠 10 秒的文件兜底。
  try {
    const accessor = (ctx as unknown as {
      config?: { onChange?: (listener: (values: unknown) => void) => unknown };
    }).config;
    accessor?.onChange?.((values) => {
      pushConfig(normalizeConfig(values));
    });
  } catch {
    // 旧版浮屿没有 onChange，继续走轮询。
  }

  syncConfig(true);
  void poll();
  ctx.setInterval(() => { void poll(); }, POLL_MS);
  ctx.setInterval(() => { syncConfig(); }, CONFIG_POLL_MS);

  process.on("exit", killChild);
}
