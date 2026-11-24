import assert from "node:assert/strict";
import test from "node:test";
import { bubbles, capsulePath, capsulePerimeter, fillXOf, levelOf, sparkles, starPath, wavePath, wavePathH } from "../src/gauge.ts";
import { parseBattery } from "../src/parse.ts";
import { DEFAULT_CONFIG, TONES, evaluateAlerts, isPlugged, normalizeConfig, toneOf } from "../src/types.ts";

test("capsulePath keeps the stroke inside the box", () => {
  const d = capsulePath(100, 40, 2);
  assert.ok(d.startsWith("M "));
  assert.ok(d.endsWith("Z"));
  assert.equal((d.match(/A /g) ?? []).length, 4);
  assert.ok(!d.includes("NaN"));
});

test("capsulePerimeter matches straight edges plus two half circles", () => {
  const w = 100;
  const h = 40;
  const expected = 2 * (w - h) + Math.PI * h;
  assert.ok(Math.abs(capsulePerimeter(w, h) - expected) < 0.001);
});

test("fillXOf maps percent to an x coordinate", () => {
  assert.equal(fillXOf(0, 1, 60), 1);
  assert.equal(fillXOf(100, 1, 60), 61);
  assert.equal(fillXOf(50, 1, 60), 31);
  assert.equal(fillXOf(140, 1, 60), 61);
  assert.equal(fillXOf(-20, 1, 60), 1);
});

test("wavePathH stays smooth, closed and fills to the left of the edge", () => {
  const d = wavePathH(80, 40, 90, 4);
  assert.ok(d.startsWith("M 40 -90"));
  assert.ok(d.includes(" Q "));
  assert.ok(d.includes(" T "));
  assert.ok(d.endsWith("Z"));
  // 实心区在液面左侧，闭合边落在画布外的 -90
  assert.ok(d.includes(" L -90 180 L -90 -90 Z"));
  assert.ok(!d.includes("NaN"));
});

test("levelOf maps percent to a y coordinate", () => {
  assert.equal(levelOf(0, 1, 60), 61);
  assert.equal(levelOf(100, 1, 60), 1);
  assert.equal(levelOf(50, 1, 60), 31);
  assert.equal(levelOf(140, 1, 60), 1);
  assert.equal(levelOf(-20, 1, 60), 61);
});

test("wavePath stays smooth, closed and fills below the waterline", () => {
  const d = wavePath(200, 80, 40, 90, 4);
  // 起点比 -period 再多 4px：动画平移一个周期后左边缘仍在画布外，不会露出竖缝
  assert.ok(d.startsWith("M -94 40"));
  assert.ok(d.includes(" Q "));
  assert.ok(d.includes(" T "));
  assert.ok(d.endsWith("Z"));
  // 实心区在液面下方，闭合边落到下边界 80
  assert.ok(d.includes(" L -94 80 Z"));
  assert.ok(!d.includes("NaN"));
});

test("bubbles and sparkles are deterministic and inside bounds", () => {
  const a = bubbles(5, 200, 80);
  const b = bubbles(5, 200, 80);
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  for (const item of a) {
    assert.ok(item.x >= 0 && item.x <= 200);
    assert.ok(item.y >= 0 && item.y <= 80);
    assert.ok(item.r > 0);
  }

  const s = sparkles(6, 200, 80);
  assert.deepEqual(s, sparkles(6, 200, 80));
  assert.equal(s.length, 6);
  for (const item of s) {
    assert.ok(item.x >= 0 && item.x <= 200);
    assert.ok(item.y >= 0 && item.y <= 80);
  }
});

test("starPath draws four closed points", () => {
  const d = starPath(10, 10, 4);
  assert.ok(d.startsWith("M 10 6"));
  assert.equal((d.match(/ Q /g) ?? []).length, 4);
  assert.ok(d.endsWith("Z"));
});

test("parseBattery accepts a normal reading", () => {
  const result = parseBattery('{"ok":true,"percent":68,"charging":true,"full":false,"ac":true,"minutes":48,"name":"BAT0"}');
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.reading.percent, 68);
  assert.equal(result.reading.charging, true);
  assert.equal(result.reading.full, false);
  assert.equal(result.reading.minutes, 48);
  assert.equal(result.reading.name, "BAT0");
});

test("parseBattery survives noisy output and clamps the level", () => {
  const noisy = parseBattery('WARNING: something\n{"ok":true,"percent":180,"minutes":"n/a"}\n');
  assert.equal(noisy.kind, "ok");
  if (noisy.kind !== "ok") return;
  assert.equal(noisy.reading.percent, 100);
  assert.equal(noisy.reading.minutes, null);
  assert.equal(noisy.reading.charging, false);

  const negative = parseBattery('{"ok":true,"percent":-5}');
  assert.equal(negative.kind, "ok");
  if (negative.kind !== "ok") return;
  assert.equal(negative.reading.percent, 0);
});

test("parseBattery separates no-battery from unreadable output", () => {
  const none = parseBattery('{"ok":false,"reason":"no-battery"}');
  assert.deepEqual(none, { kind: "none", reason: "no-battery" });

  assert.deepEqual(parseBattery(""), { kind: "bad" });
  assert.deepEqual(parseBattery("not json at all"), { kind: "bad" });
  assert.deepEqual(parseBattery('{"ok":true,'), { kind: "bad" });
});

test("toneOf uses fixed charging colours and level thresholds on battery", () => {
  assert.equal(toneOf(30, true, "green", "#000000"), TONES.green);
  assert.equal(toneOf(30, true, "blue", "#000000"), TONES.blue);
  assert.equal(toneOf(100, true, "blue", "#000000"), TONES.blue);
  assert.equal(toneOf(30, true, "accent", "#000000"), "var(--fuyu-plugin-accent)");
  assert.equal(toneOf(30, true, "custom", "#123456"), "#123456");
  assert.equal(toneOf(30, true, "custom", "nope"), TONES.blue);

  assert.equal(toneOf(15, false, "blue", "#123456"), TONES.red);
  assert.equal(toneOf(20, false, "blue", "#123456"), TONES.red);
  assert.equal(toneOf(21, false, "blue", "#123456"), TONES.amber);
  assert.equal(toneOf(40, false, "blue", "#123456"), TONES.amber);
  assert.equal(toneOf(41, false, "blue", "#123456"), TONES.green);
});

test("isPlugged keeps the charge colour after a full battery", () => {
  const base = { charging: false, ac: false, full: false };
  assert.equal(isPlugged(base), false);
  assert.equal(isPlugged({ ...base, charging: true }), true);
  // 满电时 charging 是 false，但插着电源仍算接电，不能掉回放电的绿色。
  assert.equal(isPlugged({ ...base, ac: true, full: true }), true);
});

test("normalizeConfig fills defaults and rejects bad values", () => {
  assert.deepEqual(normalizeConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ style: "sparkle", chargeColor: "blue", showRing: true }), {
    style: "sparkle",
    chargeColor: "blue",
    customColor: "#3da9ff",
    showRing: true,
    animate: true,
    alertLow: true,
    lowAt: "20",
    alertFull: true,
  });
  assert.deepEqual(normalizeConfig({ style: "nope", chargeColor: "nope", animate: false }), {
    style: "wave",
    chargeColor: "blue",
    customColor: "#3da9ff",
    showRing: false,
    animate: false,
    alertLow: true,
    lowAt: "20",
    alertFull: true,
  });
  // 阈值只认四档，别的一律退回 20；提醒开关显式 false 才关。
  assert.equal(normalizeConfig({ lowAt: "25" }).lowAt, "20");
  assert.equal(normalizeConfig({ lowAt: "30" }).lowAt, "30");
  assert.equal(normalizeConfig({ alertLow: false }).alertLow, false);
});

test("evaluateAlerts fires once per crossing and resets with hysteresis", () => {
  const config = { ...DEFAULT_CONFIG, lowAt: "20" };
  let state = { low: false, full: false };

  // 21% 不报，20% 报一次。
  let r = evaluateAlerts(21, false, false, config, state);
  assert.equal(r.fire, null);
  state = r.next;
  r = evaluateAlerts(20, false, false, config, state);
  assert.equal(r.fire, "low");
  state = r.next;

  // 停在 20% 不再重复报。
  r = evaluateAlerts(19, false, false, config, state);
  assert.equal(r.fire, null);
  state = r.next;

  // 回血到 26%（阈值 +5 以上）才算解除，之后 20% 能再报。
  r = evaluateAlerts(26, false, false, config, state);
  assert.equal(r.fire, null);
  state = r.next;
  r = evaluateAlerts(20, false, false, config, state);
  assert.equal(r.fire, "low");
  state = r.next;

  // 插上电源就解除低电量，充到 100% 报一次充满。
  r = evaluateAlerts(50, true, false, config, state);
  assert.equal(r.fire, null);
  assert.equal(r.next.low, false);
  state = r.next;
  r = evaluateAlerts(100, true, true, config, state);
  assert.equal(r.fire, "full");
  state = r.next;
  r = evaluateAlerts(100, true, true, config, state);
  assert.equal(r.fire, null);

  // 关掉开关就不报。
  const off = { ...config, alertLow: false, alertFull: false };
  r = evaluateAlerts(10, false, false, off, { low: false, full: false });
  assert.equal(r.fire, null);
  r = evaluateAlerts(100, true, true, off, { low: false, full: false });
  assert.equal(r.fire, null);
});

test("parseBattery keeps wattage optional and drops bogus values", () => {
  const withPower = parseBattery('{"ok":true,"percent":50,"watts":5.239,"minutesToFull":48}');
  assert.equal(withPower.kind, "ok");
  assert.equal(withPower.reading.watts, 5.2);
  assert.equal(withPower.reading.minutesToFull, 48);

  const zero = parseBattery('{"ok":true,"percent":50,"watts":0,"minutesToFull":0}');
  assert.equal(zero.kind, "ok");
  assert.equal(zero.reading.watts, null);
  assert.equal(zero.reading.minutesToFull, null);

  const missing = parseBattery('{"ok":true,"percent":50}');
  assert.equal(missing.kind, "ok");
  assert.equal(missing.reading.watts, null);
  assert.equal(missing.reading.minutesToFull, null);
});
