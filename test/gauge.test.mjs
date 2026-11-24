import assert from "node:assert/strict";
import test from "node:test";
import { bubbles, capsulePath, capsulePerimeter, levelOf, sparkles, starPath, wavePath } from "../src/gauge.ts";
import { parseBattery } from "../src/parse.ts";
import { DEFAULT_CONFIG, TONES, isPlugged, normalizeConfig, toneOf } from "../src/types.ts";

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

test("levelOf maps percent to a y coordinate", () => {
  assert.equal(levelOf(0, 1, 60), 61);
  assert.equal(levelOf(100, 1, 60), 1);
  assert.equal(levelOf(50, 1, 60), 31);
  assert.equal(levelOf(140, 1, 60), 1);
  assert.equal(levelOf(-20, 1, 60), 61);
});

test("wavePath stays smooth, closed and inside the canvas", () => {
  const d = wavePath(200, 80, 40, 90, 4);
  assert.ok(d.startsWith("M -90 40"));
  assert.ok(d.includes(" Q "));
  assert.ok(d.includes(" T "));
  assert.ok(d.endsWith("Z"));
  // 底部闭合到下边界 80，左边界多画一个周期 -90
  assert.ok(d.includes(" L 315 80 L -90 80 Z"));
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
  });
  assert.deepEqual(normalizeConfig({ style: "nope", chargeColor: "nope", animate: false }), {
    style: "wave",
    chargeColor: "blue",
    customColor: "#3da9ff",
    showRing: false,
    animate: false,
  });
});
