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

apply({
  dataDir,
  clients: {
    publish: (topic, value) => published.push({ topic, value }),
    handle: (name, fn) => handlers.set(name, fn),
  },
  commands: { register: () => {} },
  setInterval: () => () => {},
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return async () => clearTimeout(handle);
  },
});

await new Promise((resolve) => setTimeout(resolve, 3000));

assert.ok(handlers.has("battery.getState"), "getState handler registered");
assert.ok(handlers.has("battery.getConfig"), "getConfig handler registered");
const statePublishes = published.filter((item) => item.topic === "battery.state");
assert.ok(statePublishes.length > 0, "host published at least one snapshot");
const last = statePublishes.at(-1);
assert.equal(last.topic, "battery.state");
assert.equal(typeof last.value.ok, "boolean");

const config = await handlers.get("battery.getConfig")();
assert.equal(typeof config.style, "string", "config has a style");
assert.equal(typeof config.animate, "boolean", "config has animate");

if (last.value.ok) {
  assert.ok(last.value.percent >= 0 && last.value.percent <= 100, "percent within range");
  assert.equal(typeof last.value.name, "string");
}

const snapshot = await handlers.get("battery.getState")();
console.log(JSON.stringify({ publishes: published.length, snapshot }, null, 2));
