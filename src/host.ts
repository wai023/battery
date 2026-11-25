/// <reference types="node" />
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "fuyu-plugin";
import { messagesV1 } from "fuyu-plugin/services";
import { parseBattery, type BatteryParse } from "./parse.ts";
import {
  DEFAULT_CONFIG,
  HUD_GAP_MS,
  HUD_MAX_MS,
  INITIAL_STATE,
  METHODS,
  TOPICS,
  evaluateAlerts,
  isPlugged,
  normalizeConfig,
  type AlertState,
  type BatteryConfig,
  type BatteryState,
  type HudKind,
  type HudPayload,
} from "./types.ts";

export const name = "battery";
export const inject = {
  clients: null,
  commands: null,
  "messages/v1": null,
};

// 电池容量变化慢，完整读 30 秒一次；插拔电交给 800 毫秒一次的轻量快检。
const POLL_MS = 30_000;
const TICK_MS = 800;
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
  let alerts: AlertState = { low: false, full: false };

  // 快检 800 毫秒一轮，值没变就别推——否则窗口被无意义地重渲染。
  let lastSignature = "";
  const signatureOf = () =>
    [
      state.ok,
      state.percent,
      state.charging,
      state.full,
      state.ac,
      state.minutes,
      state.watts,
      state.minutesToFull,
      state.name,
      state.error,
    ].join("|");

  const publish = (force = false) => {
    const next = signatureOf();
    if (!force && next === lastSignature) return;
    lastSignature = next;
    ctx.clients.publish(TOPICS.state, state);
  };

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

  // ---- 临时浮窗 ----
  // 内容挂在岛的 island.overlay/v1 插槽上：宿主只发数据和管时序，不用实验窗口接口，
  // 当前客户端就能显示；位置由宿主的浮层布局决定，始终在岛下方。
  let hudSeq = 0;
  let hudShowing = false;
  let hudPending = false;
  let hudTimer: (() => void) | null = null;
  let lastHud: HudPayload | null = null;
  let lastHudStamp = 0;
  const lastHudAt: Partial<Record<HudKind, number>> = {};

  function hideHud() {
    if (hudTimer) {
      hudTimer();
      hudTimer = null;
    }
    hudShowing = false;
    lastHud = null;
  }

  function showHud(kind: HudKind, reading: BatteryState, force = false) {
    if (!force) {
      if (!config.hud || hudShowing || hudPending) return;
      const now = Date.now();
      if (now - (lastHudAt[kind] ?? 0) < HUD_GAP_MS) return;
      lastHudAt[kind] = now;
      hudPending = true;
    }

    try {
      hudSeq += 1;
      const payload: HudPayload = {
        seq: hudSeq,
        kind,
        percent: reading.percent,
        minutes: kind === "plug" ? reading.minutesToFull ?? reading.minutes : reading.minutes,
        charging: reading.charging,
      };
      ctx.clients.publish(TOPICS.hud, payload);
      hudShowing = true;
      lastHud = payload;
      lastHudStamp = Date.now();
      // 播完由浮层侧回报 hudDone；这里另有 3.5 秒兜底，漏了也会撤掉。
      hudTimer = ctx.setTimeout(() => { hideHud(); }, HUD_MAX_MS);
    } finally {
      hudPending = false;
    }
  }

  function triggerHud(kind: HudKind, reading: BatteryState) {
    const snapshot = { ...reading };
    ctx.setTimeout(() => { showHud(kind, snapshot); }, 0);
  }

  // ---- 常驻 PowerShell 子进程：一次启动，之后每 30 秒发一行取一次数 ----
  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = "";
  let nextId = 1;
  let waiter: { id: number; resolve: (line: string) => void; timer: () => Promise<void> } | null = null;

  function settle(line: string) {
    const current = waiter;
    if (!current) return;
    waiter = null;
    void current.timer();
    current.resolve(line);
  }

  // 每行都带 id：0 是脚本自己推送的快照（拔插电），其余是请求应答。
  // 按 id 配对比「先到先得」可靠——推送可能插在请求与应答之间。
  function deliver(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let id = -1;
    const at = trimmed.indexOf("{");
    if (at >= 0) {
      try {
        const parsed = JSON.parse(trimmed.slice(at)) as { id?: unknown };
        if (typeof parsed.id === "number") id = parsed.id;
      } catch {
        return; // 不是 JSON，丢掉
      }
    }

    if (id === 0) {
      applyPush(trimmed);
      return;
    }
    if (waiter && id === waiter.id) {
      settle(trimmed);
      return;
    }
    // 对不上号的应答直接丢弃，避免错位成下一次请求的结果。
  }

  function drain() {
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      deliver(line);
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
  // PING 读完整数据（WMI），POLL 只读内核电源位，SCREEN 只读鼠标所在屏，都是几十微秒到几十毫秒。
  function request(kind: "PING" | "POLL" | "SCREEN" = "PING"): Promise<string> {
    return new Promise((resolve) => {
      if (!ensureChild() || !child) {
        resolve("");
        return;
      }
      const id = nextId;
      nextId = nextId >= 1_000_000 ? 1 : nextId + 1;
      const timer = ctx.setTimeout(() => {
        killChild();
        settle("");
      }, TIMEOUT_MS);
      waiter = { id, resolve, timer };
      try {
        child.stdin.write(`${kind} ${id}\n`, "utf8");
      } catch {
        killChild();
        settle("");
      }
    });
  }

  // 读数和主动推送共用这一条落地路径：更新 state、跑提醒、推给窗口。
  function applyReading(parsed: BatteryParse): BatteryState {
    const now = Date.now();
    const before = { ok: state.ok, ac: state.ac };

    if (parsed.kind === "ok") {
      state = { ...state, ...parsed.reading, error: null, updatedAt: now };

      const result = evaluateAlerts(state.percent, isPlugged(state), state.full, config, alerts);
      alerts = result.next;
      if (result.fire === "low") {
        if (config.hud) triggerHud("low", state);
        else notify("电量偏低", `还剩 ${state.percent}%，接上电源吧`);
      } else if (result.fire === "full") {
        if (config.hud) triggerHud("full", state);
        else notify("电池已充满", "可以拔掉电源，长期满电插着会加速老化");
      }

      // 插拔之后 WMI 的功率和剩余时间要过一两秒才更新，再补一次完整读。
      // before.ok 为 false 时是启动后的第一次读数，只当基线，不当成一次插拔。
      if (before.ok && before.ac !== state.ac) {
        triggerHud(state.ac ? "plug" : "unplug", state);
        ctx.setTimeout(() => { void poll(); }, 1_500);
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
  }

  // 脚本自己推来的快照（拔插电）：不等请求队列，直接落到界面上。
  function applyPush(raw: string) {
    const parsed = parseBattery(raw);
    if (parsed.kind === "bad") return;
    applyReading(parsed);
  }

  // 一次只跑一个请求：频繁的 POLL 不能把 PING 的应答挤掉。
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  // 完整读：WMI，拿到电量、功率与剩余时间。
  function poll(): Promise<BatteryState> {
    return enqueue(async () => {
      const parsed = parseBattery(await request("PING"));
      return applyReading(parsed);
    });
  }

  // 轻量快检：只问内核 AC 位，插拔电在 800 毫秒内反映到界面上。
  let tickBusy = false;
  function tick() {
    if (tickBusy) return;
    tickBusy = true;
    void enqueue(async () => {
      const parsed = parseBattery(await request("POLL"));
      return applyReading(parsed);
    }).finally(() => { tickBusy = false; });
  }

  ctx.clients.handle(METHODS.getState, () => {
    if (Date.now() - state.updatedAt > STALE_MS) void poll();
    return state;
  });
  ctx.clients.handle(METHODS.getConfig, () => syncConfig());
  ctx.clients.handle(METHODS.getHud, () =>
    hudShowing && lastHud && Date.now() - lastHudStamp < HUD_MAX_MS ? lastHud : null,
  );
  ctx.clients.handle(METHODS.refresh, () => poll());
  // 窗口播完淡出就收窗，比固定等 3.5 秒跟手。
  ctx.clients.handle(METHODS.hudDone, () => { hideHud(); });

  ctx.commands.register("refresh", () => poll(), {
    title: { "zh-CN": "刷新电量", en: "Refresh battery level" },
  });

  // 依次弹四种浮窗，用来核对位置、配色和时序，不必真的插拔电源。
  let hudTest = 0;
  function runHudTest() {
    const kinds: HudKind[] = ["plug", "unplug", "low", "full"];
    const kind = kinds[hudTest % kinds.length];
    hudTest = (hudTest + 1) % kinds.length;
    const sample: BatteryState = {
      ...state,
      ok: true,
      percent: kind === "low" ? 20 : kind === "full" ? 100 : kind === "unplug" ? 56 : 68,
      charging: kind === "plug",
      ac: kind === "plug" || kind === "full",
      full: kind === "full",
      minutes: kind === "plug" ? 80 : 132,
      minutesToFull: kind === "plug" ? 80 : null,
      updatedAt: Date.now(),
    };
    void (async () => {
      await hideHud();
      await showHud(kind, sample, true);
    })();
  }
  ctx.commands.register("hud-test", runHudTest, {
    title: { "zh-CN": "测试电量浮窗", en: "Test battery HUD" },
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
  ctx.setInterval(tick, TICK_MS);
  ctx.setInterval(() => { void poll(); }, POLL_MS);
  ctx.setInterval(() => { syncConfig(); }, CONFIG_POLL_MS);

  process.on("exit", killChild);
}
