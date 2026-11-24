// 冒烟测试：把打包后的 host.js 放进一个假 ctx 里跑一次真实读取。
// 需要本机有 PowerShell 与电池；不进入 npm test，避免无电池环境误报。
/* eslint-disable no-restricted-globals -- 这是脱离宿主跑的独立脚本，没有 ctx 可用 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../build/package/dist/host.js";

const dataDir = mkdtempSync(join(tmpdir(), "fuyu-battery-"));
const published = [];
const handlers = new Map();
const intervals = [];

apply({
  dataDir,
  clients: {
    publish: (topic, value) => published.push({ at: Date.now(), topic, value }),
    handle: (name, fn) => handlers.set(name, fn),
  },
  commands: { register: () => {} },
  setInterval: (fn, ms) => {
    intervals.push(ms);
    const handle = setInterval(fn, ms);
    return () => clearInterval(handle);
  },
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return async () => clearTimeout(handle);
  },
});

await new Promise((resolve) => setTimeout(resolve, 4000));

assert.ok(handlers.has("battery.getState"), "getState handler registered");
assert.ok(handlers.has("battery.getConfig"), "getConfig handler registered");

// 快检与完整读都要排上：800 ms 一轮的 POLL，30 秒一轮的 PING。
assert.ok(intervals.includes(800), "fast tick registered");
assert.ok(intervals.includes(30000), "full poll registered");

const statePublishes = published.filter((item) => item.topic === "battery.state");
assert.ok(statePublishes.length > 0, "host published at least one snapshot");

// 4 秒里 tick 跑了 5 次左右，但值没变就不该重复推送，否则窗口一直重渲染。
assert.ok(
  statePublishes.length <= 4,
  `pushed ${statePublishes.length} times in 4s, expected only real changes`,
);

const last = statePublishes.at(-1);
assert.equal(typeof last.value.ok, "boolean");

const config = await handlers.get("battery.getConfig")();
assert.equal(typeof config.style, "string", "config has a style");
assert.equal(typeof config.animate, "boolean", "config has animate");

if (last.value.ok) {
  assert.ok(last.value.percent >= 0 && last.value.percent <= 100, "percent within range");
  assert.equal(typeof last.value.name, "string");
}

const snapshot = await handlers.get("battery.getState")();
console.log(
  JSON.stringify(
    { publishes: statePublishes.length, intervals, state: snapshot },
    null,
    2,
  ),
);
process.exit(0);
